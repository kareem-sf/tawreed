"""Lightweight gettext-free i18n for Tawreed.

Why not gettext?
- Tawreed only has two languages (English + Arabic), and the
  strings are short UI labels, not full sentences. A gettext
  pipeline (.po/.mo files, ``pybabel``, locale fallbacks) would
  be overkill.
- We want auto-detection from the system locale on first launch,
  and a runtime language switcher on the Settings page. With a
  dict-of-dicts, that's 4 lines. With gettext, it's a re-parse of
  the .mo file.
- The translated strings live in the source code, so a developer
  adding a new key sees both the English and the Arabic in the
  diff. With gettext, the .po file is in a different repo or
  directory and tends to drift.

Thread safety
-------------
- ``I18n`` is a ``QObject`` because the language_changed signal
  is connected to Qt slots in main.py.
- The ``_instance`` global is set once on first ``get_i18n()``
  call. We never reset it (the language preference persists in
  config.json, but the runtime object is process-lifetime).
- The translations dict is read-only at runtime, so no lock is
  needed on the read path.
"""

from __future__ import annotations

from PySide6.QtCore import QLocale, QObject, Signal

SUPPORTED_LANGUAGES = ("en", "ar")

TRANSLATIONS: dict[str, dict[str, str]] = {
    "en": {
        "app_title": "Tawreed",
        "nav_workspace": "Workspace",
        "nav_history": "History",
        "nav_settings": "Settings",
        "nav_about": "About",
        "process_button": "Process BOQ",
        "select_file": "Select Excel file",
        "drag_drop_hint": "Drag and drop your BOQ here, or click to browse",
        "ready": "Ready",
        "processing": "Processing…",
        "done": "Done",
        "error": "Error",
        "failed": "Failed",
        "open_output": "Open Output",
        "show_in_folder": "Show in Folder",
        "save": "Save",
        "test_connection": "Test Connection",
        "connection_success": "Connection successful",
        "connection_failed": "Connection failed",
        "reset": "Reset everything",
        "reset_confirm_title": "Confirm reset",
        "reset_confirm_body": "This will delete your API key, history, and all output files. Type RESET to confirm.",
        "language": "Language",
        "language_en": "English",
        "language_ar": "العربية",
        "drop_zone_title": "Drop a BOQ Excel file here",
        "drop_zone_subtitle": "or click to browse  ·  .xlsx only",
        "no_file_selected": "No file selected",
        "idle": "Idle",
        "awaiting_input": "Awaiting input…",
        "streaming_ai": "Streaming AI output…",
        "processing_complete": "Processing complete!",
        "open_excel": "Open Excel",
        "complete": "Complete",
        "successfully_generated": "Successfully generated Work Packages!",
        "failed_to_process": "Failed to process BOQ:",
        "save_settings": "Save Settings",
        "reset_everything": "Reset everything…",
        "save_failed": "Save failed",
        "connection_successful": "Connection successful!",
        "reset_everything_question": "Reset everything?",
        "reset_confirm_details": "This will delete:\n  • Your API key\n  • Configuration settings\n  • Processing history\n  • Output files\n  • Saved window state\n\nType RESET to confirm.",
        # History page
        "history_page_title": "Processing History",
        "history_page_subtitle": "Every run is logged locally. Double-click a row to open the output Excel.",
        "refresh_button": "↻  Refresh",
        "open_selected_button": "Open Selected",
        "delete_selected_button": "Delete Selected",
        "load_failed": "Load failed",
        "failed_to_load_history": "Failed to load history:",
        "empty_history": "Empty",
        "no_history_yet": "No processing history yet. Run a BOQ from the Workspace to see results here.",
        "nothing_selected": "Nothing selected",
        "pick_row_first": "Pick a row first.",
        "file_missing": "File missing",
        "output_file_missing": "Output file no longer exists:",
        "open_failed": "Open failed",
        "could_not_open_file": "Could not open the file:",
        "delete_run_question": "Delete run?",
        "delete_run_confirm": 'Remove "{proj}" (id={entry_id}) from history?\n\nThe output Excel file on disk is NOT touched — only the database row is deleted.',
    },
    "ar": {
        "app_title": "توريد",
        "nav_workspace": "مساحة العمل",
        "nav_history": "السجل",
        "nav_settings": "الإعدادات",
        "nav_about": "حول",
        "process_button": "معالجة جدول الكميات",
        "select_file": "اختر ملف Excel",
        "drag_drop_hint": "اسحب وأفلت جدول الكميات هنا، أو انقر للتصفح",
        "ready": "جاهز",
        "processing": "جارٍ المعالجة…",
        "done": "تم",
        "error": "خطأ",
        "failed": "فشل",
        "open_output": "فتح المخرجات",
        "show_in_folder": "إظهار في المجلد",
        "save": "حفظ",
        "test_connection": "اختبار الاتصال",
        "connection_success": "نجح الاتصال",
        "connection_failed": "فشل الاتصال",
        "reset": "إعادة ضبط الكل",
        "reset_confirm_title": "تأكيد إعادة الضبط",
        "reset_confirm_body": "سيؤدي هذا إلى حذف مفتاح API والسجل وجميع ملفات الإخراج. اكتب RESET للتأكيد.",
        "language": "اللغة",
        "language_en": "English",
        "language_ar": "العربية",
        "drop_zone_title": "اسحب وأفلت ملف Excel هنا",
        "drop_zone_subtitle": "أو انقر للتصفح  ·  .xlsx فقط",
        "no_file_selected": "لم يتم اختيار أي ملف",
        "idle": "خامل",
        "awaiting_input": "في انتظار الإدخال…",
        "streaming_ai": "جارٍ بث إخراج الذكاء الاصطناعي…",
        "processing_complete": "تمت المعالجة!",
        "open_excel": "فتح Excel",
        "complete": "مكتمل",
        "successfully_generated": "تم إنشاء حزم العمل بنجاح!",
        "failed_to_process": "فشل في معالجة جدول الكميات:",
        "save_settings": "حفظ الإعدادات",
        "reset_everything": "إعادة ضبط الكل…",
        "save_failed": "فشل الحفظ",
        "connection_successful": "نجح الاتصال!",
        "reset_everything_question": "إعادة ضبط الكل؟",
        "reset_confirm_details": "سيؤدي هذا إلى حذف:\n  • مفتاح API الخاص بك\n  • إعدادات التكوين\n  • سجل المعالجة\n  • ملفات الإخراج\n  • حالة النافذة المحفوظة\n\nاكتب RESET للتأكيد.",
        # History page
        "history_page_title": "سجل المعالجة",
        "history_page_subtitle": "كل عملية مسجلة محليًا. انقر نقرًا مزدوجًا على صف لفتح ملف Excel الإخراج.",
        "refresh_button": "↻  تحديث",
        "open_selected_button": "فتح المحدد",
        "delete_selected_button": "حذف المحدد",
        "load_failed": "فشل التحميل",
        "failed_to_load_history": "فشل في تحميل السجل:",
        "empty_history": "فارغ",
        "no_history_yet": "لا يوجد سجل معالجة بعد. قم بمعالجة جدول كميات من مساحة العمل لرؤية النتائج هنا.",
        "nothing_selected": "لم يتم اختيار شيء",
        "pick_row_first": "اختر صفًا أولًا.",
        "file_missing": "الملف مفقود",
        "output_file_missing": "ملف الإخراج لم يعد موجودًا:",
        "open_failed": "فشل الفتح",
        "could_not_open_file": "تعذر فتح الملف:",
        "delete_run_question": "حذف العملية؟",
        "delete_run_confirm": 'إزالة "{proj}" (id={entry_id}) من السجل؟\n\nملف Excel الإخراج على القرص لم يتم لمسه — فقط صف قاعدة البيانات يتم حذفه.',
    },
}


class I18n(QObject):
    """Singleton i18n object. Lives in a process-global."""

    language_changed = Signal(str)

    def __init__(self) -> None:
        super().__init__()
        self._language: str = "en"

    @property
    def language(self) -> str:
        return self._language

    def is_rtl(self) -> bool:
        """Right-to-left layout if the active language is Arabic."""
        return self._language == "ar"

    def set_language(self, language: str) -> None:
        """Set the active language. No-op for unsupported codes.

        Emits ``language_changed`` so the GUI can retranslate itself
        and flip the layout direction.
        """
        if language not in SUPPORTED_LANGUAGES:
            return
        if language == self._language:
            return  # no change -> no signal -> no retranslate churn
        self._language = language
        self.language_changed.emit(language)

    def tr(self, key: str) -> str:
        """Return the translated string for ``key`` in the active
        language. Falls back to the key itself if the key is missing
        in both languages — that way a missing translation is
        visible in the UI instead of silently rendering empty."""
        return TRANSLATIONS.get(self._language, {}).get(key, key)


_instance: I18n | None = None


def get_i18n() -> I18n:
    """Return the process-global I18n instance, creating it on first
    call. Auto-detects the initial language from the system locale
    on first creation only — subsequent calls return the same
    object with whatever language the user has selected."""
    global _instance
    if _instance is None:
        _instance = I18n()
        # Auto-detect on first creation. QLocale.system().name()
        # returns something like "en_US", "ar_EG", or just "C".
        # We only care about the leading language code.
        locale_name = QLocale.system().name()
        lang = locale_name.split("_", 1)[0].lower()
        if lang in SUPPORTED_LANGUAGES:
            _instance._language = lang
    return _instance


def detect_system_language() -> str:
    """Return the system's preferred language code (e.g. "en" or
    "ar"), defaulting to "en" if the locale can't be determined.

    Exposed as a separate function so tests can verify the
    detection logic without instantiating the singleton."""
    locale_name = QLocale.system().name()
    lang = locale_name.split("_", 1)[0].lower()
    return lang if lang in SUPPORTED_LANGUAGES else "en"
