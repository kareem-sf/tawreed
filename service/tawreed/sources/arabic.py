"""Words and lines from PDF character boxes, in reading order for Arabic and English alike.

Many Arabic PDFs store words in drawing order, so reading the stored text gives lines backwards. Rebuilding each
line from where every character is drawn gives the reading order whatever the storage order: Arabic words right to
left, runs of English words and numbers left to right, and vowel marks kept with their letter. Each word keeps its
position, which is how a PDF table is later split into columns. (Adapted from Quantix.)
"""

import re
import unicodedata
from dataclasses import dataclass
from statistics import median

ARABIC = re.compile(r"[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]")
_MARKS = re.compile(r"[ً-ٰٟۖ-ۭ]")


@dataclass(frozen=True)
class Char:
    """One character as PDFium places it: PDF points, origin at the bottom left of the page."""

    text: str
    left: float
    bottom: float
    right: float
    top: float

    @property
    def x(self) -> float:
        return (self.left + self.right) / 2

    @property
    def y(self) -> float:
        return (self.bottom + self.top) / 2


@dataclass(frozen=True)
class Word:
    text: str  # in reading order
    left: float
    right: float
    bottom: float
    top: float


def has_arabic(text: str) -> bool:
    return bool(ARABIC.search(text))


def lines_from_chars(chars: list[Char]) -> list[list[Word]]:
    """Lines from the top of the page down; each line's words from left to right as drawn."""
    visible = [c for c in chars if c.text not in ("\r", "\n", "")]
    lines: list[list[Char]] = []
    for char in sorted(visible, key=lambda c: -c.y):
        if lines and abs(_centre(lines[-1]) - char.y) <= _height(lines[-1] + [char]) / 2:
            lines[-1].append(char)
        else:
            lines.append([char])
    words = [[_word(w) for w in _words(sorted(line, key=lambda c: c.x))] for line in lines]
    return [line for line in words if line]


def reading_text(words: list[Word]) -> str:
    """The words (given left to right as drawn) as one string in reading order."""
    ordered = [w.text for w in sorted(words, key=lambda w: w.left)]
    if any(has_arabic(w) for w in ordered):
        ordered = _right_to_left(ordered)
    return unicodedata.normalize("NFKC", " ".join(ordered)).strip()


def _centre(line: list[Char]) -> float:
    return sum(c.y for c in line) / len(line)


def _height(chars: list[Char]) -> float:
    return max(max(c.top - c.bottom for c in chars), 1.0)


def _words(visual: list[Char]) -> list[list[Char]]:
    solid = [c for c in visual if not c.text.isspace()]
    if not solid:
        return []
    gap = 0.3 * median(max(c.right - c.left, 0.1) for c in solid)
    words: list[list[Char]] = [[]]
    previous: Char | None = None
    for char in visual:
        if char.text.isspace():
            words.append([])
        elif previous is not None and char.left - previous.right > gap and not _is_mark(char):
            words.append([char])
        else:
            words[-1].append(char)
        if not char.text.isspace():
            previous = char
    return [w for w in words if w]


def _is_mark(char: Char) -> bool:
    return unicodedata.category(char.text[0]) == "Mn"


def _word(chars: list[Char]) -> Word:
    return Word(
        text=_word_text(chars),
        left=min(c.left for c in chars),
        right=max(c.right for c in chars),
        bottom=min(c.bottom for c in chars),
        top=max(c.top for c in chars),
    )


def _word_text(word: list[Char]) -> str:
    if not has_arabic("".join(c.text for c in word)):
        return "".join(c.text for c in sorted(word, key=lambda c: c.x))
    bases = _lam_before_alef(sorted((c for c in word if not _is_mark(c)), key=lambda c: -c.x))
    marks = [c for c in word if _is_mark(c)]
    if not bases:
        return "".join(c.text for c in marks)
    seated: list[list[str]] = [[b.text] for b in bases]
    for mark in marks:
        nearest = min(range(len(bases)), key=lambda i: abs(bases[i].x - mark.x))
        seated[nearest].append(mark.text)
    return "".join("".join(parts) for parts in seated)


_ALEFS = set("اأإآٱ")


def _lam_before_alef(bases: list[Char]) -> list[Char]:
    """A lam-alef ligature is one glyph that PDFium gives as two characters in the same box, in whatever order the
    PDF stores them. Arabic has lam-alef ligatures and no alef-lam ones, so the lam reads first."""
    ordered = list(bases)
    for i in range(len(ordered) - 1):
        a, b = ordered[i], ordered[i + 1]
        same_box = abs(a.left - b.left) < 0.1 and abs(a.right - b.right) < 0.1
        if same_box and a.text in _ALEFS and b.text == "ل":
            ordered[i], ordered[i + 1] = b, a
    return ordered


def _right_to_left(words: list[str]) -> list[str]:
    """Visual left-to-right words to reading order: reverse, keeping runs of non-Arabic words left to right."""
    result: list[str] = []
    run: list[str] = []
    for word in reversed(words):
        if has_arabic(word):
            result.extend(reversed(run))
            run = []
            result.append(word)
        else:
            # "1%" is drawn "%1" in Arabic text: put the sign back after the number.
            run.append(word[1:] + word[0] if word[:1] in "%٪" and word[1:2].isdigit() else word)
    result.extend(reversed(run))
    return result


def normalised(text: str) -> str:
    """Text for comparing, not showing: no vowel marks or tatweel, one alef, ya and ta marbuta form, lower case,
    single spaces."""
    text = unicodedata.normalize("NFKC", text)
    text = _MARKS.sub("", text).replace("ـ", "")
    text = re.sub("[أإآٱ]", "ا", text).replace("ى", "ي").replace("ة", "ه")
    return " ".join(text.lower().split())
