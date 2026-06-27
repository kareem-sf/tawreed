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
        "loaded_prefix": "Loaded:",
        "saved_prefix": "Saved:",
        "error_prefix": "Error:",
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
        "file_dialog_title": "Select BOQ Excel File",
        "file_dialog_filter": "Excel Files (*.xlsx)",
        "console_card_title": "Live Console",
        "recent_files_label": "Recent Files",
        "app_name_label": "Tawreed",
        "process_button_prefix": "▶  ",
        "idle": "Idle",
        "awaiting_input": "Awaiting input…",
        "streaming_ai": "Streaming AI output…",
        "processing_complete": "Processing complete!",
        "open_excel": "Open Excel",
        "clear": "Clear",
        "clear_log": "Clear Log",
        "complete": "Complete",
        "successfully_generated": "Successfully generated Work Packages!",
        "failed_to_process": "Failed to process BOQ:",
        "save_settings": "Save Settings",
        "reset_everything": "Reset everything…",
        "save_failed": "Save failed",
        "connection_successful": "Connection successful!",
        "success_title": "Success",
        "reset_everything_question": "Reset everything?",
        "reset_confirm_details": "This will delete:\n  • Your API key\n  • Configuration settings\n  • Processing history\n  • Output files\n  • Saved window state\n\nType RESET to confirm.",
        # History page
        "workspace_page_title": "BOQ Processor",
        "workspace_page_subtitle": "Drop a Bill of Quantities Excel file and let Tawreed categorize the items into high-level work packages.",
        "settings_required_title": "Settings Required",
        "settings_required_message": "Please configure an API key in Settings first.",
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
        "reveal_failed": "Reveal failed",
        "could_not_open_folder": "Could not open the folder",
        "delete_run_confirm": 'Remove "{proj}" (id={entry_id}) from history?\n\nThe output Excel file on disk is NOT touched — only the database row is deleted.',
        # About page
        "about_page_subtitle": "AI-driven BOQ work-package extraction for construction quantity surveyors.",
        "about_author_credits": "Author & Credits",
        "about_built_by": "Built by",
        "about_bio_text": "Tawreed was built to help construction quantity surveyors categorize Bill of Quantities items into high-level work packages using LLMs. The current build is a single-user desktop app; all settings, history, and outputs live locally on your machine.",
        "about_project": "Project",
        "about_app_name": "App name",
        "about_version": "Version",
        "about_license": "License",
        "about_repository": "Repository",
        "about_status": "Status",
        "about_status_released": "Released",
        "about_built_with": "Built With",
        "about_language": "Language",
        "about_ui_framework": "UI framework",
        "about_llm_providers": "LLM providers",
        "about_llm_providers_list": "OpenAI · Anthropic · Google Gemini · OpenAI-compatible",
        "about_data": "Data",
        "about_packaging": "Packaging",
        "about_open_repository": "Open Repository",
        "about_author_website": "Author Website",
        "about_copyright_license": "Released under the",
        "about_python_version": "Python 3.10+",
        "about_data_stack": "openpyxl · pandas · SQLite",
        "about_packaging_type": "PyInstaller (onedir)",
        # Main window
        "app_logo_text": "TAWREED",
        "app_tagline": "AI BOQ work packages",
        "app_brand": "Tawreed",
        "author_mark": "T",
        # Settings page
        "settings_page_title": "Settings",
        "settings_page_subtitle": "Configure the LLM provider used to categorize BOQ items. Switching providers automatically updates the model list and base URL.",
        "provider_card_title": "LLM Provider",
        "model_card_title": "Model",
        "language_card_title": "Language",
        "theme_card_title": "Theme",
        "connection_card_title": "Connection",
        "danger_zone_title": "Danger Zone",
        "refresh_models_button": "↻  Refresh Models",
        "refresh_models_tooltip": "Fetch the live list from the provider's /models endpoint",
        "base_url_label": "Base URL",
        "base_url_placeholder": "https://...",
        "api_key_label": "API Key",
        "api_key_placeholder": "Paste your API key (stored locally only)",
        "show_api_key_checkbox": "Show API key",
        "language_hint": "Switch between English and Arabic user interface",
        "theme_hint": "Switch between dark and light color schemes",
        "danger_zone_warning": "Reset clears your API key, model choice, processing history, and any generated Excel files. This cannot be undone.",
        "base_url_required_title": "Base URL required",
        "base_url_required_message": "The '{provider}' provider requires a Base URL.",
        "api_key_required_title": "API key required",
        "api_key_required_message": "Please enter an API key.",
        "model_required_title": "Model required",
        "model_required_message": "Please select or type a model name.",
        "refresh_base_url_required": "Enter a Base URL before refreshing '{provider}' models.",
        "refresh_api_key_required": "Enter an API key so we can fetch the live model list.",
        "test_base_url_required": "Enter a Base URL before testing '{provider}'.",
        "test_api_key_required": "Enter an API key to test the connection.",
        "test_model_required": "Pick or type a model name first.",
        "connection_failed_title": "Connection failed",
        "connection_failed_message": "Could not reach the API. Verify the key, base URL, and model name.",
        "reset_failed_title": "Reset failed",
        "reset_complete_message": "✓ Everything reset.",
        "reset_complete_title": "Reset complete",
        "reset_complete_details": "Tawreed has been reset.\n\n{details}",
        # Settings page status messages
        "settings_saved": "✓ Settings saved.",
        "fetching_models": "Fetching…",
        "refresh_models_button_text": "↻  Refresh Models",
        "testing_connection": "Testing…",
        "test_connection_button_text": "Test Connection",
        "connection_successful_status": "✓ Connection successful.",
        "connection_failed_status": "✗ Connection failed. Check key, URL, and model.",
        "reset_cancelled": "Reset cancelled.",
        "test_failed_title": "Test failed",
        "test_failed_message": "Test failed",
        "delete_run_question": "Remove run?",
        "could_not_open_file": "Could not open the file",
        "unexpected_error_title": "Tawreed — unexpected error",
        "unexpected_error_message": "An unhandled error occurred:\n\n{error}\n\nDetails have been saved to:\n{log_path}",
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
        "loaded_prefix": "تم التحميل:",
        "saved_prefix": "تم الحفظ:",
        "error_prefix": "خطأ:",
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
        "file_dialog_title": "اختر ملف Excel لجدول الكميات",
        "file_dialog_filter": "ملفات Excel (*.xlsx)",
        "console_card_title": "الوحدة الطرفية المباشرة",
        "recent_files_label": "الملفات الأخيرة",
        "app_name_label": "توريد",
        "process_button_prefix": "▶  ",
        "idle": "خامل",
        "awaiting_input": "في انتظار الإدخال…",
        "streaming_ai": "جارٍ بث إخراج الذكاء الاصطناعي…",
        "processing_complete": "تمت المعالجة!",
        "open_excel": "فتح Excel",
        "clear": "مسح",
        "clear_log": "مسح السجل",
        "complete": "مكتمل",
        "successfully_generated": "تم إنشاء حزم العمل بنجاح!",
        "failed_to_process": "فشل في معالجة جدول الكميات:",
        "save_settings": "حفظ الإعدادات",
        "reset_everything": "إعادة ضبط الكل…",
        "save_failed": "فشل الحفظ",
        "connection_successful": "نجح الاتصال!",
        "success_title": "نجاح",
        "reset_everything_question": "إعادة ضبط الكل؟",
        "reset_confirm_details": "سيؤدي هذا إلى حذف:\n  • مفتاح API الخاص بك\n  • إعدادات التكوين\n  • سجل المعالجة\n  • ملفات الإخراج\n  • حالة النافذة المحفوظة\n\nاكتب RESET للتأكيد.",
        # History page
        "workspace_page_title": "معالج جدول الكميات",
        "workspace_page_subtitle": "اسحب وأفلت ملف Excel لجدول الكميات ودع توريد يصنف العناصر إلى حزم عمل عالية المستوى.",
        "settings_required_title": "الإعدادات مطلوبة",
        "settings_required_message": "الرجاء تكوين مفتاح API في الإعدادات أولًا.",
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
        "reveal_failed": "فشل الكشف",
        "could_not_open_folder": "تعذر فتح المجلد",
        "delete_run_confirm": 'إزالة "{proj}" (id={entry_id}) من السجل؟\n\nملف Excel الإخراج على القرص لم يتم لمسه — فقط صف قاعدة البيانات يتم حذفه.',
        # About page
        "about_page_subtitle": "استخراج حزم العمل من جدول الكميات باستخدام الذكاء الاصطناعي للمساحين الكميين في البناء.",
        "about_author_credits": "المؤلف والاعتمادات",
        "about_built_by": "تم بناؤه بواسطة",
        "about_bio_text": "تم بناء توريد لمساعدة مساحين الكميات في البناء على تصنيف عناصر جدول الكميات إلى حزم عمل عالية المستوى باستخدام نماذج اللغة الكبيرة. الإصدار الحالي هو تطبيق سطح مكتب لمستخدم واحد؛ جميع الإعدادات والسجل والمخرجات تعيش محليًا على جهازك.",
        "about_project": "المشروع",
        "about_app_name": "اسم التطبيق",
        "about_version": "الإصدار",
        "about_license": "الرخصة",
        "about_repository": "المستودع",
        "about_status": "الحالة",
        "about_status_released": "تم الإصداره",
        "about_built_with": "تم بناؤه باستخدام",
        "about_language": "اللغة",
        "about_ui_framework": "إطار واجهة المستخدم",
        "about_llm_providers": "مقدمو نماذج اللغة الكبيرة",
        "about_llm_providers_list": "OpenAI · Anthropic · Google Gemini · متوافق مع OpenAI",
        "about_data": "البيانات",
        "about_packaging": "التعبئة",
        "about_open_repository": "فتح المستودع",
        "about_author_website": "موقع المؤلف",
        "about_copyright_license": "تم الإصداره بموجب رخصة",
        "about_python_version": "Python 3.10+",
        "about_data_stack": "openpyxl · pandas · SQLite",
        "about_packaging_type": "PyInstaller (onedir)",
        # Main window
        "app_logo_text": "توريد",
        "app_tagline": "حزم عمل BOQ بالذكاء الاصطناعي",
        "app_brand": "توريد",
        "author_mark": "ت",
        # Settings page
        "settings_page_title": "الإعدادات",
        "settings_page_subtitle": "ضبط مزود نموذج اللغة الكبيرة المستخدم لتصنيف عناصر جدول الكميات. يؤدي تغيير المزود إلى تحديث قائمة النماذج وعناوين URL تلقائيًا.",
        "provider_card_title": "مزود نموذج اللغة الكبيرة",
        "model_card_title": "النموذج",
        "language_card_title": "اللغة",
        "theme_card_title": "السمة",
        "connection_card_title": "الاتصال",
        "danger_zone_title": "منطقة الخطر",
        "refresh_models_button": "↻  تحديث النماذج",
        "refresh_models_tooltip": "جلب القائمة المباشرة من نقطة نهاية /models للمزود",
        "base_url_label": "عنوان URL الأساسي",
        "base_url_placeholder": "https://...",
        "api_key_label": "مفتاح API",
        "api_key_placeholder": "الصق مفتاح API الخاص بك (مخزن محليًا فقط)",
        "show_api_key_checkbox": "إظهار مفتاح API",
        "language_hint": "التبديل بين واجهة المستخدم الإنجليزية والعربية",
        "theme_hint": "التبديل بين سمات الألوان الداكنة والفاتحة",
        "danger_zone_warning": "يؤدي إعادة الضبط إلى مسح مفتاح API الخاص بك واختيار النموذج وسجل المعالجة وأي ملفات Excel تم إنشاؤها. لا يمكن التراجع عن هذا.",
        "base_url_required_title": "عنوان URL الأساسي مطلوب",
        "base_url_required_message": "مزود '{provider}' يتطلب عنوان URL أساسي.",
        "api_key_required_title": "مفتاح API مطلوب",
        "api_key_required_message": "الرجاء إدخال مفتاح API.",
        "model_required_title": "النموذج مطلوب",
        "model_required_message": "الرجاء تحديد أو كتابة اسم نموذج.",
        "refresh_base_url_required": "أدخل عنوان URL أساسي قبل تحديث نماذج '{provider}'.",
        "refresh_api_key_required": "أدخل مفتاح API حتى نتمكن من جلب القائمة المباشرة للنماذج.",
        "test_base_url_required": "أدخل عنوان URL أساسي قبل اختبار '{provider}'.",
        "test_api_key_required": "أدخل مفتاح API لاختبار الاتصال.",
        "test_model_required": "اختر أو اكتب اسم نموذج أولًا.",
        "connection_failed_title": "فشل الاتصال",
        "connection_failed_message": "خطأ في الاختبار",
        "reset_complete_message": "✓ تم إعادة ضبط كل شيء.",
        "reset_complete_title": "تمت إعادة الضبط",
        "reset_complete_details": "تم إعادة ضبط توريد.\n\n{details}",
        "settings_saved": "✓ تم حفظ الإعدادات.",
        "connection_failed_status": "✗ فشل الاتصال. تحقق من المفتاح وعنوان URL والنموذج.",
        "connection_successful_status": "✓ تم الاتصال بنجاح.",
        "test_connection_button_text": "اختبار الاتصال",
        "testing_connection": "جارٍ الاختبار…",
        "fetching_models": "جارٍ جلب النماذج…",
        "reset_failed_title": "فشل إعادة الضبط",
        "reset_cancelled": "تم إلغاء إعادة الضبط.",
        "test_failed_title": "فشل الاختبار",
        "test_failed_message": "فشل الاختبار",
        "delete_run_question": "إزالة التشغيل؟",
        "could_not_open_file": "تعذر فتح الملف",
        "unexpected_error_title": "توريد — خطأ غير متوقع",
        "unexpected_error_message": "حدث خطأ غير متوقع:\n\n{error}\n\nتم حفظ التفاصيل في:\n{log_path}",
        "refresh_models_button_text": "↻  تحديث النماذج",
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
