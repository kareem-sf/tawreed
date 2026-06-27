"""Test i18n coverage for workspace page strings."""


def test_workspace_i18n_coverage():
    """Ensure all workspace page strings are covered by i18n."""
    from core.i18n import get_i18n

    i18n = get_i18n()

    # Test English
    i18n.set_language("en")
    assert i18n.tr("loaded_prefix") == "Loaded:"
    assert i18n.tr("saved_prefix") == "Saved:"
    assert i18n.tr("error_prefix") == "Error:"

    # Test Arabic
    i18n.set_language("ar")
    assert i18n.tr("loaded_prefix") == "تم التحميل:"
    assert i18n.tr("saved_prefix") == "تم الحفظ:"
    assert i18n.tr("error_prefix") == "خطأ:"

    # Test that they work in f-strings (as used in workspace page)
    i18n.set_language("en")
    assert f"{i18n.tr('loaded_prefix')} test.xlsx" == "Loaded: test.xlsx"
    assert f"{i18n.tr('saved_prefix')} output.xlsx" == "Saved: output.xlsx"
    assert f"{i18n.tr('error_prefix')} test error" == "Error: test error"

    i18n.set_language("ar")
    assert f"{i18n.tr('loaded_prefix')} test.xlsx" == "تم التحميل: test.xlsx"
    assert f"{i18n.tr('saved_prefix')} output.xlsx" == "تم الحفظ: output.xlsx"
    assert f"{i18n.tr('error_prefix')} test error" == "خطأ: test error"
