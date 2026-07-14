"""Small, framework-independent translation service for the Python engine.

The React interface owns its own copy. This module contains only strings used
by the headless processing pipeline and generated workbooks, so importing the
engine never pulls in a desktop UI framework.
"""

from __future__ import annotations

import locale
import os
from collections.abc import Callable

from core.locales import SUPPORTED_LANGUAGES

TRANSLATIONS: dict[str, dict[str, str]] = {
    "en": {
        "analyzing_batch": "Analyzing batch {current} of {total}…",
        "api_key_missing_error": "API Key is missing. Please configure it in Settings.",
        "cannot_read_excel": "Cannot read '{file_name}': {error}",
        "cannot_write_excel": "Cannot write '{file_name}': {error}",
        "cannot_write_excel_permission": (
            "Cannot write '{file_name}' — the file is open in Excel or another program has "
            "it locked. Close it and try again."
        ),
        "categorized_items": "Categorized {count} items into work packages.",
        "completed_processing": "Completed processing {sheet_title}",
        "cover_application": "Application",
        "cover_application_value": "Tawreed BOQ Processor v{version}",
        "cover_date": "Date",
        "cover_project_name": "Project Name",
        "cover_subtitle": "BOQ Work-Package Extractor",
        "cover_title": "Tawreed",
        "default_project_name": "Tawreed Project",
        "excel_corrupt_file": (
            "'{file_name}' is corrupt or incomplete. The file may be truncated or damaged. "
            "Try re-exporting it from Excel as a new .xlsx file."
        ),
        "excel_file_not_found": "Excel file not found: {file_path}",
        "excel_invalid_format": (
            "'{file_name}' is not a valid .xlsx file. It may be password-protected, corrupt, "
            "or in a different format. Please use a standard .xlsx file exported from Excel."
        ),
        "excel_no_worksheets": "'{file_name}' has no worksheets.",
        "excel_old_format": (
            "'{file_name}' appears to be in the older .xls format. Tawreed only supports .xlsx "
            "files. Open the file in Excel and save it as .xlsx."
        ),
        "generating_output": "Generating output workbook: {output_file}",
        "large_file_detected": (
            "Large file detected ({file_size:.1f} MB). Estimated processing time: "
            "{estimated_time:.1f} seconds."
        ),
        "no_boq_items_found": "No categorizable BOQ items were found in the workbook.",
        "other_item_warning": ("1 item was assigned to Other; review it in Excel after export."),
        "other_items_warning": (
            "{count} items were assigned to Other; review them in Excel after export."
        ),
        "output_file_suffix": "_Tawreed_Output",
        "parsing_excel": "Parsing Excel BOQ file...",
        "processed_rows": "Processed {processed_rows} rows",
        "progress_approval": "Work packages are ready for approval",
        "progress_classifying": "Classifying batch {current} of {total}",
        "progress_complete": "Workbook generated successfully",
        "progress_exporting": "Generating the approved workbook",
        "progress_inspecting": "Inspecting workbook structure",
        "progress_structuring": "Structuring BOQ items into safe work batches",
        "progress_validating": "Validating item coverage and package assignments",
        "review_ready": "AI proposal ready — review is required before export.",
        "sending_request": "Sending request to AI Model ({model_id})...",
        "starting_chunked_processing": "Starting chunked processing of {sheet_title}",
        "stream_consumer_error": "Stream consumer error: {error_type}: {error_message}",
        "stream_ended_without_sentinel": (
            "AI stream ended without a completion marker. The model may have disconnected."
        ),
        "successfully_parsed": "Successfully parsed {count} items from Excel.",
        "thinking_marker": "Thinking",
        "very_large_file_detected": (
            "Very large file detected ({file_size:.1f} MB). Estimated processing time: "
            "{estimated_time:.1f} seconds. Processing will continue but may take significant time."
        ),
    },
    "ar": {
        "analyzing_batch": "جارٍ تحليل الدفعة {current} من {total}…",
        "api_key_missing_error": "مفتاح API مفقود. الرجاء تكوينه في الإعدادات.",
        "cannot_read_excel": "تعذر قراءة '{file_name}': {error}",
        "cannot_write_excel": "تعذر كتابة '{file_name}': {error}",
        "cannot_write_excel_permission": (
            "تعذر كتابة '{file_name}' — الملف مفتوح في Excel أو مقفل بواسطة برنامج آخر. "
            "أغلقه وحاول مرة أخرى."
        ),
        "categorized_items": "تم تصنيف {count} عنصرًا إلى حزم عمل.",
        "completed_processing": "تمت معالجة ورقة {sheet_title}",
        "cover_application": "التطبيق",
        "cover_application_value": "معالج جدول الكميات توريد v{version}",
        "cover_date": "التاريخ",
        "cover_project_name": "اسم المشروع",
        "cover_subtitle": "مستخرج حزم العمل من جدول الكميات",
        "cover_title": "توريد",
        "default_project_name": "مشروع توريد",
        "excel_corrupt_file": (
            "ملف '{file_name}' تالف أو غير مكتمل. قد يكون الملف مقطوعًا أو تالفًا. "
            "حاول إعادة تصديره من Excel كملف .xlsx جديد."
        ),
        "excel_file_not_found": "ملف Excel غير موجود: {file_path}",
        "excel_invalid_format": (
            "ملف '{file_name}' ليس ملف .xlsx صالحًا. قد يكون محميًا بكلمة مرور أو تالفًا "
            "أو بتنسيق مختلف. استخدم ملف .xlsx قياسيًا مُصدّرًا من Excel."
        ),
        "excel_no_worksheets": "'{file_name}' لا يحتوي على أي أوراق عمل.",
        "excel_old_format": (
            "يبدو أن ملف '{file_name}' بتنسيق .xls القديم. يدعم توريد ملفات .xlsx فقط. "
            "افتح الملف في Excel واحفظه بتنسيق .xlsx."
        ),
        "generating_output": "جارٍ إنشاء ملف Excel الناتج: {output_file}",
        "large_file_detected": (
            "تم اكتشاف ملف كبير ({file_size:.1f} ميجابايت). الوقت المقدر للمعالجة: "
            "{estimated_time:.1f} ثانية."
        ),
        "no_boq_items_found": "لم يتم العثور على بنود جدول كميات قابلة للتصنيف في الملف.",
        "other_item_warning": "تم إسناد بند واحد إلى أخرى؛ راجعه في Excel بعد التصدير.",
        "other_items_warning": ("تم إسناد {count} بنود إلى أخرى؛ راجعها في Excel بعد التصدير."),
        "output_file_suffix": "_مخرج_توريد",
        "parsing_excel": "جارٍ تحليل ملف Excel لجدول الكميات...",
        "processed_rows": "تمت معالجة {processed_rows} صفًا",
        "progress_approval": "حزم العمل جاهزة للموافقة",
        "progress_classifying": "جارٍ تصنيف الدفعة {current} من {total}",
        "progress_complete": "تم إنشاء ملف العمل بنجاح",
        "progress_exporting": "جارٍ إنشاء ملف العمل المعتمد",
        "progress_inspecting": "جارٍ فحص بنية ملف العمل",
        "progress_structuring": "جارٍ تنظيم بنود جدول الكميات في دفعات آمنة",
        "progress_validating": "جارٍ التحقق من اكتمال البنود وتعيينات الحزم",
        "review_ready": "اقتراح الذكاء الاصطناعي جاهز — المراجعة مطلوبة قبل التصدير.",
        "sending_request": "جارٍ إرسال طلب إلى نموذج الذكاء الاصطناعي ({model_id})...",
        "starting_chunked_processing": "بدء المعالجة المجزأة لورقة {sheet_title}",
        "stream_consumer_error": "خطأ في تدفق الاستجابة: {error_type}: {error_message}",
        "stream_ended_without_sentinel": (
            "انتهى تدفق الذكاء الاصطناعي دون علامة اكتمال. ربما انقطع اتصال النموذج."
        ),
        "successfully_parsed": "تم تحليل {count} عنصرًا من Excel بنجاح.",
        "thinking_marker": "جارٍ التفكير",
        "very_large_file_detected": (
            "تم اكتشاف ملف كبير جدًا ({file_size:.1f} ميجابايت). الوقت المقدر للمعالجة: "
            "{estimated_time:.1f} ثانية. ستستمر المعالجة ولكن قد تستغرق وقتًا كبيرًا."
        ),
    },
}


class _Signal:
    """Tiny callback signal used by non-Qt callers and tests."""

    def __init__(self) -> None:
        self._callbacks: list[Callable[[str], None]] = []

    def connect(self, callback: Callable[[str], None]) -> None:
        if callback not in self._callbacks:
            self._callbacks.append(callback)

    def disconnect(self, callback: Callable[[str], None]) -> None:
        if callback in self._callbacks:
            self._callbacks.remove(callback)

    def emit(self, value: str) -> None:
        for callback in tuple(self._callbacks):
            callback(value)


class I18n:
    """Translate engine and workbook copy without importing a UI toolkit."""

    def __init__(self, language: str = "en") -> None:
        self._language = language if language in SUPPORTED_LANGUAGES else "en"
        self.language_changed = _Signal()

    @property
    def language(self) -> str:
        return self._language

    def set_language(self, language: str) -> None:
        normalized = language if language in SUPPORTED_LANGUAGES else "en"
        if normalized == self._language:
            return
        self._language = normalized
        self.language_changed.emit(normalized)

    def tr(self, key: str) -> str:
        return TRANSLATIONS.get(self._language, {}).get(key, key)

    def is_rtl(self) -> bool:
        return self._language == "ar"


def detect_system_language() -> str:
    """Return a supported two-letter language code, defaulting to English."""
    candidates: list[str] = []
    try:
        current = locale.getlocale()[0]
        if current:
            candidates.append(current)
    except (TypeError, ValueError):
        pass
    candidates.extend(filter(None, (os.environ.get("LC_ALL"), os.environ.get("LANG"))))
    for candidate in candidates:
        language = candidate.split(".", 1)[0].replace("-", "_").split("_", 1)[0].casefold()
        if language in SUPPORTED_LANGUAGES:
            return language
    return "en"


_instance: I18n | None = None


def get_i18n() -> I18n:
    global _instance
    if _instance is None:
        _instance = I18n()
    return _instance


__all__ = [
    "I18n",
    "SUPPORTED_LANGUAGES",
    "TRANSLATIONS",
    "detect_system_language",
    "get_i18n",
]
