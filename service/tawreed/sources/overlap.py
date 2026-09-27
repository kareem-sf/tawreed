"""How much two BOQ files share, so a new file that repeats or revises an earlier one is noticed.

Each non-trivial row or line of text is normalised and hashed. The share is the part of the smaller file found in
the other: a full copy or a lightly revised file scores near 1, an unrelated file near 0. The engineer, not this
number, decides whether a file is an addition, a replacement or a revision."""

import hashlib
import json
from pathlib import Path
from typing import Any

from tawreed.sources.arabic import normalised
from tawreed.sources.readers import Page

MINIMUM = 12  # characters: shorter rows ("m2", "No.", a lone number) say nothing about the file


def fingerprints(pages: list[Page]) -> list[str]:
    found: set[str] = set()
    for page in pages:
        for text in _texts(page.content):
            key = normalised(text)
            if len(key) >= MINIMUM:
                found.add(hashlib.sha1(key.encode("utf-8")).hexdigest()[:16])
    return sorted(found)


def share(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / min(len(a), len(b))


def load(folder: Path) -> set[str]:
    path = folder / "fingerprints.json"
    return set(json.loads(path.read_text(encoding="utf-8"))) if path.exists() else set()


def _texts(content: dict[str, Any]):
    if content.get("kind") == "sheet":
        for row in content["rows"]:
            cells = [str(v) for v in row if v is not None]
            if cells:
                yield " | ".join(cells)
    elif content.get("kind") == "page":
        for line in content["lines"]:
            yield line["text"]
