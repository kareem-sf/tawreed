"""Test that hard-coded strings have been properly routed through i18n."""

from core.i18n import get_i18n


def test_worker_uses_i18n_for_default_project_name():
    """Test that worker.py uses i18n for default project name instead of hard-coded string."""
    # Read the worker.py file
    with open("gui/worker.py", encoding="utf-8") as f:
        content = f.read()

    # Should not contain hard-coded "Tawreed Project" strings in the error handling sections
    # (but may contain them in comments or fallback logic)
    lines = content.split("\n")

    # Check that the error handling sections use i18n
    error_section_lines = []
    in_error_section = False
    for i, line in enumerate(lines):
        if "error_msg = (" in line:
            in_error_section = True
        if in_error_section and "return {" in line:
            error_section_lines.append(lines[i + 1])  # project_name line
            in_error_section = False

    # Verify that error sections use i18n
    for line in error_section_lines:
        assert "i18n.tr" in line or "default_project_name" in line, (
            f"Error section should use i18n for project name: {line}"
        )


def test_default_project_name_translation_exists():
    """Test that default_project_name translation key exists in both languages."""
    i18n = get_i18n()

    # Test English
    i18n.set_language("en")
    assert i18n.tr("default_project_name") == "Tawreed Project"

    # Test Arabic
    i18n.set_language("ar")
    assert i18n.tr("default_project_name") == "مشروع توريد"


def test_processing_pipeline_parsing_success_uses_i18n():
    """The UI-independent pipeline owns translated processing copy."""
    with open("core/processing_pipeline.py", encoding="utf-8") as f:
        content = f.read()

    # Should use i18n for the success message
    assert 'i18n.tr("successfully_parsed")' in content, (
        "processing_pipeline.py should use i18n for parsing success message"
    )

    # Should not have hard-coded "Successfully parsed" in the main logic
    # (but may have it in fallback logic)
    lines = content.split("\n")
    for i, line in enumerate(lines):
        if "Successfully parsed" in line and 'else f"' not in line:
            # This should be in a fallback, not main logic
            context = "\n".join(lines[max(0, i - 2) : min(len(lines), i + 3)])
            assert 'else f"' in context or "if i18n else" in context, (
                f"Line {i + 1}: Hard-coded 'Successfully parsed' should be in fallback only: {line}"
            )
