"""Write the service's OpenAPI schema to a file: python -m tawreed.openapi <path>."""

import json
import sys
from pathlib import Path

from tawreed.api.app import create_app


def main() -> None:
    # The schema is built without starting the app, so the data home is never opened.
    schema = create_app(Path.home() / ".tawreed", "schema-only").openapi()
    text = json.dumps(schema, indent=2, ensure_ascii=False) + "\n"
    Path(sys.argv[1]).write_text(text, encoding="utf-8", newline="\n")  # the same file on every system


if __name__ == "__main__":
    main()
