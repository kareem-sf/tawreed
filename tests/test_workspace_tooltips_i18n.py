"""Test that workspace page tooltips are properly internationalized."""


def test_workspace_tooltips_i18n_coverage():
    """Test that workspace tooltip strings are covered by i18n."""
    from core.i18n import get_i18n

    i18n = get_i18n()

    # Test English
    i18n.set_language("en")
    assert (
        i18n.tr("open_output_tooltip")
        == "Open the most recently generated Excel in your default app"
    )
    assert (
        i18n.tr("show_in_folder_tooltip")
        == "Open the output folder in Windows Explorer with the file selected"
    )

    # Test Arabic
    i18n.set_language("ar")
    assert (
        i18n.tr("open_output_tooltip") == "فتح ملف Excel الذي تم إنشاؤه مؤخرًا في تطبيقك الافتراضي"
    )
    assert i18n.tr("show_in_folder_tooltip") == "فتح مجلد الإخراج في مستكشف Windows مع تحديد الملف"

    i18n.set_language("ar")
    assert (
        i18n.tr("open_output_tooltip") == "فتح ملف Excel الذي تم إنشاؤه مؤخرًا في تطبيقك الافتراضي"
    )
    assert i18n.tr("show_in_folder_tooltip") == "فتح مجلد الإخراج في مستكشف Windows مع تحديد الملف"
