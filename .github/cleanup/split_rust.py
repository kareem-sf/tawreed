from __future__ import annotations

from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[2]


def matching_brace(text: str, opening: int) -> int | None:
    depth = 0
    quote: str | None = None
    escaped = False
    line_comment = False
    block_comment = 0
    index = opening
    while index < len(text):
        char = text[index]
        following = text[index + 1] if index + 1 < len(text) else ""
        if line_comment:
            if char == "\n":
                line_comment = False
        elif block_comment:
            if char == "/" and following == "*":
                block_comment += 1
                index += 1
            elif char == "*" and following == "/":
                block_comment -= 1
                index += 1
        elif quote:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
        else:
            if char == "/" and following == "/":
                line_comment = True
                index += 1
            elif char == "/" and following == "*":
                block_comment = 1
                index += 1
            elif char in {'"', "'"}:
                quote = char
            elif char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    return index + 1
        index += 1
    return None


def command_group(name: str) -> str:
    value = name.lower()
    if any(token in value for token in ("update", "release")):
        return "updates"
    if any(token in value for token in ("setting", "credential", "api_key", "compatible_key", "provider", "onboarding", "model")):
        return "configuration"
    if any(token in value for token in ("revision", "workbook", "folder", "file", "bundle", "document", "output")):
        return "documents"
    if any(token in value for token in ("classification_memory", "memory")):
        return "memory"
    if any(token in value for token in ("history", "record_run", "list_run", "run_history")):
        return "history"
    if any(token in value for token in ("codex", "anthropic", "compatible", "llm", "chat", "ai_")):
        return "providers"
    if any(token in value for token in ("bootstrap", "app_log", "log_")):
        return "lifecycle"
    return "misc"


def split_commands() -> dict[str, list[str]]:
    path = ROOT / "src-tauri/src/commands.rs"
    directory = path.parent / "commands"
    if not path.exists() or directory.exists():
        return {}
    text = path.read_text(encoding="utf-8")
    items: list[tuple[int, int, str, str]] = []
    for attribute in re.finditer(r"(?m)^\s*#\[tauri::command\]\s*$", text):
        start = attribute.start()
        cursor = start
        while cursor > 0:
            previous = text.rfind("\n", 0, cursor - 1) + 1
            line = text[previous:cursor].strip()
            if line.startswith("///") or (line.startswith("#[") and line.endswith("]")):
                start = previous
                cursor = previous
            else:
                break
        signature = re.search(
            r"(?m)^(?:\s*#\[[^\n]+\]\s*\n|\s*///[^\n]*\n)*"
            r"\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z0-9_]+)\b",
            text[attribute.start():],
        )
        if not signature:
            continue
        name = signature.group(1)
        opening = text.find("{", attribute.start() + signature.end())
        if opening < 0:
            continue
        end = matching_brace(text, opening)
        if end is None:
            continue
        while end < len(text) and text[end] in " \t":
            end += 1
        if end < len(text) and text[end] == "\n":
            end += 1
        items.append((start, end, name, text[start:end].strip() + "\n"))

    unique: list[tuple[int, int, str, str]] = []
    last = -1
    for item in sorted(items):
        if item[0] >= last:
            unique.append(item)
            last = item[1]
    if len(unique) < 3:
        return {}

    groups: dict[str, list[tuple[str, str]]] = {}
    for start, end, name, body in unique:
        groups.setdefault(command_group(name), []).append((name, body))
    updated = text
    for start, end, _, _ in reversed(unique):
        updated = updated[:start] + updated[end:]
    declarations = ["", "// Command handlers are grouped by privileged capability."]
    for group in sorted(groups):
        declarations.extend((f"mod {group};", f"pub use {group}::*;"))
    path.write_text(updated.rstrip() + "\n" + "\n".join(declarations) + "\n", encoding="utf-8")
    directory.mkdir(exist_ok=True)
    for group, values in groups.items():
        body = "use super::*;\n\n" + "\n".join(source for _, source in values)
        (directory / f"{group}.rs").write_text(body, encoding="utf-8")
    return {group: [name for name, _ in values] for group, values in groups.items()}


def store_group(name: str) -> str:
    value = name.lower()
    if any(token in value for token in ("setting", "credential", "key", "provider", "onboarding", "model")):
        return "configuration"
    if any(token in value for token in ("revision", "reserve", "discard", "publish", "output", "bundle")):
        return "revisions"
    if any(token in value for token in ("run", "history", "record")):
        return "history"
    if any(token in value for token in ("memory", "classification")):
        return "memory"
    if any(token in value for token in ("project", "workspace")):
        return "projects"
    return "core"


def split_store() -> dict[str, list[str]]:
    path = ROOT / "src-tauri/src/store.rs"
    directory = path.parent / "store"
    if not path.exists() or directory.exists():
        return {}
    text = path.read_text(encoding="utf-8")
    impls: list[tuple[int, int, int]] = []
    for match in re.finditer(r"(?m)^\s*impl\s+Store\s*\{", text):
        opening = text.find("{", match.start(), match.end() + 1)
        end = matching_brace(text, opening)
        if end:
            impls.append((match.start(), opening, end))

    moves: list[tuple[int, int, str, str]] = []
    for _, opening, impl_end in impls:
        body = text[opening + 1:impl_end - 1]
        base = opening + 1
        depth = 0
        index = 0
        while index < len(body):
            char = body[index]
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
            elif depth == 0:
                method = re.match(
                    r"(?:pub(?:\(crate\))?\s+)(?:async\s+)?fn\s+([A-Za-z0-9_]+)",
                    body[index:],
                )
                if method:
                    name = method.group(1)
                    line_start = body.rfind("\n", 0, index) + 1
                    start = line_start
                    while start > 0:
                        previous = body.rfind("\n", 0, start - 1) + 1
                        line = body[previous:start].strip()
                        if line.startswith("///") or (line.startswith("#[") and line.endswith("]")):
                            start = previous
                        else:
                            break
                    method_opening = body.find("{", index + method.end())
                    method_end = matching_brace(body, method_opening)
                    if method_end:
                        end = method_end
                        while end < len(body) and body[end] in " \t":
                            end += 1
                        if end < len(body) and body[end] == "\n":
                            end += 1
                        moves.append((base + start, base + end, name, text[base + start:base + end].strip() + "\n"))
                        index = end
                        continue
            index += 1

    unique: list[tuple[int, int, str, str]] = []
    last = -1
    for item in sorted(moves):
        if item[0] >= last:
            unique.append(item)
            last = item[1]
    if len(unique) < 4:
        return {}

    groups: dict[str, list[tuple[str, str]]] = {}
    for start, end, name, body in unique:
        groups.setdefault(store_group(name), []).append((name, body))
    updated = text
    for start, end, _, _ in reversed(unique):
        updated = updated[:start] + updated[end:]
    declarations = ["", "// Store operations are grouped by persistence capability."]
    declarations.extend(f"mod {group};" for group in sorted(groups))
    path.write_text(updated.rstrip() + "\n" + "\n".join(declarations) + "\n", encoding="utf-8")
    directory.mkdir(exist_ok=True)
    for group, values in groups.items():
        body = "use super::*;\n\nimpl Store {\n" + "\n".join(source for _, source in values) + "}\n"
        (directory / f"{group}.rs").write_text(body, encoding="utf-8")
    return {group: [name for name, _ in values] for group, values in groups.items()}


def main() -> None:
    report = {"commands": split_commands(), "store": split_store()}
    (ROOT / ".deep-rust-split-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
