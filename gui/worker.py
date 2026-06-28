import asyncio
import logging
import os

from PySide6.QtCore import QObject, Signal

from core import db
from core.ai import analyze_boq_stream
from core.ai import test_connection as _test_connection
from core.excel import parse_excel, write_excel

log = logging.getLogger(__name__)


class WorkerSignals(QObject):
    log = Signal(str)
    finished = Signal(str)
    error = Signal(str)


def check_connection(provider: str, api_key: str, base_url: str, model_id: str) -> bool:
    """Synchronous wrapper for the settings-page "Test Connection" button.

    Delegates to ``core.ai.test_connection`` so that all four
    providers (OpenAI, Anthropic Claude, Google Gemini, OpenAI-
    Compatible) are handled with the correct auth header and URL
    path. The previous version of this function only knew how to
    hit an OpenAI-style /chat/completions endpoint, which silently
    401'd on every Claude call.

    ``provider`` is the PROVIDERS dict key (e.g. "OpenAI",
    "Claude", "Google", "OpenAI Compatible"). ``base_url`` is the
    user-entered endpoint; for the named providers, the canonical
    URL is taken from PROVIDERS unless the user overrode it
    (e.g. a self-hosted OpenAI-compatible service).
    """
    try:
        # The async function in core.ai handles every provider's
        # auth scheme, endpoint path, and error envelope. We
        # run it to completion in a fresh event loop so the
        # caller (which is itself a background thread) doesn't
        # have to deal with asyncio.
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # We're inside an existing event loop (qasync).
                # Schedule and wait synchronously via to_thread is
                # awkward; instead just create a one-shot loop in
                # a new thread.
                import concurrent.futures

                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
                    return ex.submit(
                        asyncio.run,
                        _test_connection(provider, api_key, model_id, base_url),
                    ).result(timeout=15.0)
        except RuntimeError:
            pass
        return asyncio.run(_test_connection(provider, api_key, model_id, base_url))
    except Exception:
        log.exception("Connection check failed")
        return False


def run_analysis(
    api_key: str,
    base_url: str,
    model_id: str,
    system_prompt: str,
    user_prompt: str,
    signals: WorkerSignals,
    i18n=None,
) -> dict:
    """Drive the streaming LLM call and forward tokens to the UI.

    The consumer contract with ``analyze_boq_stream`` is:

    * Incremental yields are ``(text, is_thought)`` — forward to the
      live console verbatim, bracketed by ``[Thinking]`` markers
      when ``is_thought`` is true.
    * The final yield is the sentinel ``("__DONE__", parsed_dict)``.
      Anything else (a missing sentinel, a ``StopIteration``, a
      generator exception) is treated as a failure and surfaced
      in the returned dict under ``error`` so the caller can show
      it in the error dialog.

    Returns the parsed result dict. Always returns; never raises.
    """
    gen = analyze_boq_stream(
        api_key=api_key,
        base_url=base_url,
        model_id=model_id,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
    )
    last_was_thought: bool | None = None
    parsed: dict = {}
    try:
        for token, is_thought in gen:
            # Terminal sentinel — the result is in ``token``.
            if token == "__DONE__":
                parsed = is_thought if isinstance(is_thought, dict) else {}
                break

            if is_thought:
                if last_was_thought is not True:
                    signals.log.emit(
                        "\n[" + (i18n.tr("thinking_marker") if i18n else "Thinking") + "] "
                    )
                    last_was_thought = True
                signals.log.emit(token)
            else:
                if last_was_thought is True:
                    signals.log.emit("\n")
                last_was_thought = False
                signals.log.emit(token)
    except Exception as e:
        # The generator raised mid-iteration. Wrap into a structured
        # error so the caller can show it; don't crash the worker.
        error_msg = (
            i18n.tr("stream_consumer_error").format(
                error_type=type(e).__name__, error_message=str(e)
            )
            if i18n
            else f"Stream consumer error: {type(e).__name__}: {e}"
        )
        return {
            "project_name": i18n.tr("default_project_name") if i18n else "Tawreed Project",
            "date": "",
            "items": {},
            "error": error_msg,
        }

    if not parsed:
        # Generator ended without emitting the sentinel (e.g. the
        # user closed the console mid-run, or the upstream call
        # returned an empty stream). Surface a clean error rather
        # than letting the workspace show the old generic message.
        error_msg = (
            i18n.tr("stream_ended_without_sentinel")
            if i18n
            else "AI stream ended without a __DONE__ sentinel. The model may have disconnected mid-response."
        )
        return {
            "project_name": i18n.tr("default_project_name") if i18n else "Tawreed Project",
            "date": "",
            "items": {},
            "error": error_msg,
        }
    return parsed


class BOQProcessor:
    def __init__(self, file_path: str, signals: WorkerSignals, i18n=None):
        self.file_path = file_path
        self.signals = signals
        self.settings = db.get_settings()
        self._i18n = i18n

    async def process(self):
        try:
            self.signals.log.emit(
                self._i18n.tr("parsing_excel") if self._i18n else "Parsing Excel BOQ file..."
            )
            markdown_content, data_mapping, headers_mapping = await asyncio.to_thread(
                parse_excel, self.file_path, self._i18n
            )
            self.signals.log.emit(
                self._i18n.tr("successfully_parsed").format(count=len(data_mapping))
                if self._i18n
                else f"Successfully parsed {len(data_mapping)} items from Excel."
            )

            api_key = self.settings.get("api_key", "")
            model_id = self.settings.get("model_id") or self.settings.get("model", "gpt-4.1-mini")
            base_url = self.settings.get("base_url", "https://api.openai.com/v1")

            if not api_key:
                raise ValueError(
                    self._i18n.tr("api_key_missing_error")
                    if self._i18n
                    else "API Key is missing. Please configure it in Settings."
                )

            self.signals.log.emit(
                self._i18n.tr("sending_request").format(model_id=model_id)
                if self._i18n
                else f"Sending request to AI Model ({model_id})..."
            )

            system_prompt = (
                "You are an expert Quantity Surveyor and Construction Estimator.\n"
                "Your task is to analyze the Bill of Quantities (BOQ) items provided in Markdown format, "
                "and categorize each item (using its Global ID, e.g., 'R1', 'R2') "
                "into a MACRO-LEVEL Work Package (e.g., Concrete Works, Masonry, HVAC, Plumbing, Electrical, Finishes).\n"
                "DO NOT use granular item names as packages. Group related items into high-level trades.\n"
                "You must return a JSON object with the following structure:\n"
                "{\n"
                '  "project_name": "Name of the project or default name",\n'
                '  "date": "YYYY-MM-DD or default current date",\n'
                '  "items": {\n'
                '    "R1": "Work Package Name",\n'
                '    "R2": "Work Package Name"\n'
                "  }\n"
                "}\n"
                "Output ONLY valid JSON. Do not write anything other than the JSON object."
            )

            user_prompt = f"Analyze and categorize these BOQ items:\n\n{markdown_content}"

            parsed_data = await asyncio.to_thread(
                run_analysis,
                api_key,
                base_url,
                model_id,
                system_prompt,
                user_prompt,
                self.signals,
                self._i18n,
            )

            # The streaming layer embeds any non-fatal error in the
            # result dict under "error". Surface it in the UI rather
            # than silently producing an empty Excel file.
            stream_error = parsed_data.get("error")
            if stream_error:
                self.signals.error.emit(stream_error)
                return

            project_name = parsed_data.get(
                "project_name",
                self._i18n.tr("default_project_name") if self._i18n else "Tawreed Project",
            )
            date = parsed_data.get("date", "")
            item_categories = parsed_data.get("items", {})

            self.signals.log.emit(
                self._i18n.tr("ai_identified_project").format(project_name=project_name)
                if self._i18n
                else f"\nAI identified project: {project_name}"
            )
            self.signals.log.emit(
                self._i18n.tr("categorized_items").format(count=len(item_categories))
                if self._i18n
                else f"Categorized {len(item_categories)} items into work packages."
            )

            output_dir = db.get_outputs_dir()
            base_name = os.path.basename(self.file_path)
            name_without_ext, _ = os.path.splitext(base_name)
            output_file = os.path.join(output_dir, f"{name_without_ext}_Tawreed_Output.xlsx")

            self.signals.log.emit(
                self._i18n.tr("generating_output").format(output_file=output_file)
                if self._i18n
                else f"Generating output workbook: {output_file}"
            )

            await asyncio.to_thread(
                write_excel,
                output_file,
                data_mapping,
                item_categories,
                project_name,
                date,
                self._i18n,
            )

            await asyncio.to_thread(
                db.add_history, project_name, len(set(item_categories.values())), output_file
            )

            self.signals.finished.emit(output_file)

        except Exception as e:
            self.signals.error.emit(str(e))
