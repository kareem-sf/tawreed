"""Numbers as BOQs write them. Only a value that is wholly a number counts: "120 m3" or "L.S." is text."""

import math
import re
from decimal import Decimal, InvalidOperation

_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
_NUMBER = re.compile(r"^[+-]?(\d{1,3}(?:[,.' ]\d{3})+|\d+)?(?:[.,]\d+)?$")


def parse_number(value: object) -> Decimal | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return Decimal(value)
    if isinstance(value, float):
        return None if math.isnan(value) or math.isinf(value) else Decimal(repr(value))
    text = str(value).translate(_DIGITS).replace("٫", ".").replace("٬", ",").replace(" ", " ").strip()
    negative = text.startswith("(") and text.endswith(")")
    if negative:
        text = text[1:-1].strip()
    if not text or not _NUMBER.match(text) or not any(c.isdigit() for c in text):
        return None
    try:
        number = Decimal(_plain(text))
    except InvalidOperation:
        return None
    return -number if negative else number


def _plain(text: str) -> str:
    """Turn 1,234.50 or 1.234,50 or 1 234,5 into plain decimal text."""
    text = text.replace(" ", "").replace("'", "")
    sign = text[0] if text[:1] in "+-" else ""
    body = text[len(sign) :]
    if re.fullmatch(r"\d{1,3}(,\d{3})+", body):  # 1,234 and 12,345,678: thousands
        return sign + body.replace(",", "")
    if re.fullmatch(r"\d{1,3}(\.\d{3}){2,}", body):  # 1.234.567: thousands
        return sign + body.replace(".", "")
    if body.rfind(",") > body.rfind("."):  # 12,5 and 1.234,50: the comma is the decimal mark
        return sign + body.replace(".", "").replace(",", ".")
    return sign + body.replace(",", "")


def text_of(value: object) -> str:
    """How a cell value reads, for keeping beside the parsed number."""
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()
