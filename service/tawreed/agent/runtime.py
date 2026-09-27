"""One agent per project, at work on a background thread: a turn at a time, each rebuilt from the project's records.

A project gets a turn when the engineer said or decided something new, when its last turn was cut short, or when
there is work the agent can do without waiting for the engineer. Stop takes effect between steps. An AI failure,
or a long run without hearing from the engineer, pauses the project with a notice; a message or an answer resumes it.
"""

import asyncio
import logging
import os
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from pydantic_ai import Agent, UsageLimitExceeded, UsageLimits
from pydantic_ai.exceptions import ModelAPIError, ToolRetryError, UnexpectedModelBehavior
from pydantic_ai.messages import ModelMessage, RetryPromptPart, ToolCallPart
from pydantic_ai.models import Model
from pydantic_ai.settings import ModelSettings
from pydantic_ai.usage import RunUsage
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from tawreed import decisions, packages, settings
from tawreed.agent import instructions, records, tools
from tawreed.agent.records import Message, TurnRecord
from tawreed.ai import connections, providers
from tawreed.core.db import now
from tawreed.projects import Project
from tawreed.sources import Source

log = logging.getLogger("tawreed.agent")
os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")  # Pydantic AI's advertisement, not wanted in the service log

TURN_BUDGET = 15  # turns without hearing from the engineer before the agent pauses
REQUEST_TIMEOUT = 180.0  # seconds for one model request, so a stalled service can't hold the project
RETRIES = 2  # turns cut short by a passing AI failure that are tried again before the project pauses
RETRY_WAIT = 5.0  # seconds before the first retry; each further one waits longer
BLOCKING = ("consent", "plan", "question", "publish")  # while one of these waits, only news gives the agent a turn


def chosen(home: Path) -> tuple[dict[str, Any], str] | None:
    """The connection and model Tawreed works with, if one is chosen and still there."""
    choice = settings.load(home)["ai"]
    connection = choice and connections.get(home, choice["connection_id"])
    return (connection, choice["model"]) if connection else None


class Worker:
    def __init__(
        self,
        home: Path,
        sessions: sessionmaker[Session],
        model: Callable[[], Model | None] | None = None,
        sees_images: Callable[[], bool] | None = None,
    ):
        self.home = home
        self.sessions = sessions
        self.model = model or self._chosen_model
        self.sees_images = sees_images or self._chosen_sees_images
        self._wake = threading.Event()
        self._closing = threading.Event()
        self._thread = threading.Thread(target=self._run, name="tawreed-agent", daemon=True)
        self._stops: dict[str, threading.Event] = {}
        self._working: str | None = None
        self._failures: dict[str, int] = {}

    # The engineer's side ------------------------------------------------------------------------------------------

    def start(self) -> None:
        self._thread.start()
        self.wake()

    def close(self) -> None:
        self._closing.set()
        for stop in self._stops.values():
            stop.set()
        self._wake.set()
        self._thread.join(timeout=15)

    def wake(self) -> None:
        self._wake.set()

    def resume(self, project_id: str) -> None:
        """The engineer wrote or answered: a stopped or paused agent carries on."""
        self._stop(project_id).clear()
        self._failures.pop(project_id, None)
        self.wake()

    def stop(self, project_id: str) -> None:
        """Stop the agent between steps. It stays stopped, even after a restart, until the engineer writes."""
        self._stop(project_id).set()
        with self.sessions() as session:
            project = session.get(Project, project_id)
            if project and not project.agent_paused:
                project.agent_paused = True
                records.notice(session, project_id, "stopped")
                session.commit()

    def status(self, project_id: str) -> str:
        """working | paused | idle"""
        if self._working == project_id:
            return "working"
        with self.sessions() as session:
            project = session.get(Project, project_id)
            return "paused" if project and project.agent_paused else "idle"

    def _stop(self, project_id: str) -> threading.Event:
        return self._stops.setdefault(project_id, threading.Event())

    # The work ---------------------------------------------------------------------------------------------------

    def _chosen_model(self) -> Model | None:
        found = chosen(self.home)
        if not found:
            return None
        connection, model = found
        return providers.build_model(connection["provider"], model, connection["api_key"], connection["base_url"])

    def _chosen_sees_images(self) -> bool:
        found = chosen(self.home)
        return bool(found and found[0]["checks"].get(found[1], {}).get("sees_images"))

    def _run(self) -> None:
        while not self._closing.is_set():
            self._wake.wait()
            self._wake.clear()
            try:
                asyncio.run(self.work())
            except Exception:
                log.exception("The agent loop failed")

    async def work(self) -> None:
        """Give turns until no project needs one."""
        busy = True
        while busy and not self._closing.is_set():
            busy = False
            with self.sessions() as session:
                ids = list(session.scalars(select(Project.id).where(Project.agent_paused.is_(False))))
            for project_id in ids:
                if self._stop(project_id).is_set() or self._closing.is_set():
                    continue
                self._working = project_id
                try:
                    busy = await self._work_on(project_id) or busy
                finally:
                    self._working = None

    async def _work_on(self, project_id: str) -> bool:
        found = chosen(self.home)
        if not found:
            return False
        connection = found[0]
        with self.sessions() as session:
            project = session.get(Project, project_id)
            read = select(Source.id).where(Source.project_id == project_id, Source.status == "read").limit(1)
            if project is None or session.scalars(read).first() is None:
                return False
            if decisions.needs_consent(session, project_id, connection["id"]):
                decisions.ask_consent(session, project_id, connection)
                session.commit()
                return False
            last = records.last_turn(session, project_id)
            if not needs_turn(session, project, last):
                return False
            if records.turns_since(session, project_id, last_heard(session, project_id)) >= TURN_BUDGET:
                project.agent_paused = True
                records.notice(session, project_id, "long_run")
                session.commit()
                return False
        model = self.model()
        if model is None:
            return False
        return await self._turn(model, project_id)

    async def _turn(self, model: Model, project_id: str) -> bool:
        with self.sessions() as session:
            project = session.get(Project, project_id)
            last = records.last_turn(session, project_id)
            unfinished = bool(last and last.ended in records.UNFINISHED)
            prompt = instructions.situation(session, project, last.started_at if last else None, unfinished)
            record = TurnRecord(project_id=project_id, model=model.model_name[:200])
            session.add(record)
            session.commit()
            record_id = record.id
        language = settings.load(self.home)["language"]
        turn = tools.Turn(self.home, self.sessions, project_id, self._stop(project_id), self.sees_images())
        trace = Trace()
        try:
            await run_turn(model, turn, instructions.instructions(language), prompt, trace)
            self._failures.pop(project_id, None)
            return True
        except tools.Stopped:
            trace.ended = "stopped"
            return False
        except ModelAPIError as error:
            code, params = providers.explain(error)
            trace.ended, trace.note = "ai_failed", code
            failures = self._failures[project_id] = self._failures.get(project_id, 0) + 1
            if passing(error) and failures <= RETRIES:
                log.info("A turn was cut short (%s); trying again", code)
                await asyncio.sleep(RETRY_WAIT * failures)
                return True
            self._pause(project_id, "ai_failed", problem=code, **params)
            return False
        except Exception as error:
            log.exception("The agent's turn on %s failed", project_id)
            trace.ended, trace.note = "failed", f"{type(error).__name__}: {str(error)[:500]}"
            self._pause(project_id, "agent_failed")
            return False
        finally:
            with self.sessions() as session:
                record = session.get(TurnRecord, record_id)
                record.ended, record.note, record.calls = trace.ended, trace.note, trace.calls
                record.ended_at = now()
                record.requests = trace.usage.requests
                record.input_tokens, record.output_tokens = trace.usage.input_tokens, trace.usage.output_tokens
                session.commit()

    def _pause(self, project_id: str, code: str, **params: Any) -> None:
        with self.sessions() as session:
            project = session.get(Project, project_id)
            if project is None:
                return
            project.agent_paused = True
            records.notice(session, project_id, code, **params)
            session.commit()


def last_heard(session: Session, project_id: str) -> datetime | None:
    """When the engineer last wrote or answered."""
    wrote = session.scalar(
        select(func.max(Message.created_at)).where(Message.project_id == project_id, Message.sender == "engineer")
    )
    answered = session.scalar(
        select(func.max(decisions.Decision.answered_at)).where(
            decisions.Decision.project_id == project_id, decisions.Decision.status == "answered"
        )
    )
    moments = [m for m in (wrote, answered) if m is not None]
    return max(moments) if moments else None


def needs_turn(session: Session, project: Project, last: TurnRecord | None) -> bool:
    """Whether the agent has something to act on: news from the engineer, an unfinished turn, or work it can do
    without waiting for them."""
    heard = last_heard(session, project.id)
    if last is None or (heard and heard > last.started_at):
        return True
    if last.ended in records.UNFINISHED:
        return True
    waiting = decisions.waiting(session, project.id)
    if any(d.kind in BLOCKING for d in waiting):
        return False
    coverage = packages.coverage(session, project.id, decisions.waiting_items(session, project.id))
    if coverage.pages_left:
        return True
    if coverage.pending_files or not coverage.items:
        return False
    if not packages.packages(session, project.id) or coverage.unplaced:
        return True
    if coverage.waiting:
        return False
    return not asked_to_publish_since_change(session, project)


def asked_to_publish_since_change(session: Session, project: Project) -> bool:
    latest = session.scalars(
        select(decisions.Decision)
        .where(
            decisions.Decision.project_id == project.id,
            decisions.Decision.kind == "publish",
            decisions.Decision.status != "withdrawn",
        )
        .order_by(decisions.Decision.created_at.desc())
        .limit(1)
    ).first()
    return bool(latest and latest.created_at >= project.updated_at)


# One turn ---------------------------------------------------------------------------------------------------------


@dataclass
class Trace:
    """What one turn did, filled in while it runs, so it is there however the turn ends."""

    ended: str | None = "done"
    note: str | None = None
    calls: list[dict[str, Any]] = field(default_factory=list)
    usage: RunUsage = field(default_factory=RunUsage)


def calls_in(messages: list[ModelMessage]) -> list[dict[str, Any]]:
    """Each tool call in the turn, with the reason when Tawreed sent it back."""
    sent_back = {
        p.tool_call_id: str(p.content)[:300]
        for m in messages
        for p in m.parts
        if isinstance(p, RetryPromptPart) and p.tool_name
    }
    return [
        {"tool": p.tool_name, "sent_back": sent_back.get(p.tool_call_id)}
        for m in messages
        for p in m.parts
        if isinstance(p, ToolCallPart)
    ]


def passing(error: ModelAPIError) -> bool:
    """A failure that usually clears on its own: a timeout, a dropped connection, rate limiting, a server error."""
    status = getattr(error, "status_code", None)
    if isinstance(status, int):
        return status == 429 or status >= 500
    cause = type(error.__cause__).__name__.lower() if error.__cause__ else ""
    return "timeout" in cause or "connect" in cause


async def run_turn(model: Model, turn: tools.Turn, rules: str, prompt: str, trace: Trace) -> None:
    agent = Agent(
        model,
        deps_type=tools.Turn,
        instructions=rules,
        tools=tools.TOOLS,
        retries=2,
        model_settings=ModelSettings(timeout=REQUEST_TIMEOUT),
    )
    limits = UsageLimits(request_limit=instructions.STEP_LIMIT)
    async with agent.iter(prompt, deps=turn, usage_limits=limits) as run:
        try:
            asked = time.monotonic()
            async for node in run:
                if turn.stop.is_set():
                    raise tools.Stopped()
                if Agent.is_model_request_node(node):
                    asked = time.monotonic()
                    # Streamed: some services drop a long answer that arrives in one piece after a quiet minute.
                    async with node.stream(run.ctx) as answer:
                        async for _event in answer:
                            if turn.stop.is_set():
                                raise tools.Stopped()
                elif Agent.is_call_tools_node(node):
                    calls = [p.tool_name for p in node.model_response.parts if isinstance(p, ToolCallPart)]
                    log.info("Answered in %.1f s, calling %s", time.monotonic() - asked, calls)
                    if not calls:
                        return  # the agent has nothing more to do this turn
        except UsageLimitExceeded:
            trace.ended = "out_of_steps"
        except (UnexpectedModelBehavior, ToolRetryError) as error:
            # A reply the model couldn't get right ends this turn, not the project's work.
            log.info("A turn ended early: %s", str(error)[:300])
            trace.ended, trace.note = "tool_failed", str(error)[:500]
        finally:
            trace.calls, trace.usage = calls_in(run.new_messages()), run.usage
