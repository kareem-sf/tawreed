from __future__ import annotations

from pathlib import Path
import json
import re
import shutil

ROOT = Path(__file__).resolve().parents[2]
SOURCE_EXTENSIONS = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"}
IGNORED_PARTS = {".git", "node_modules", "dist", "target", ".vite", ".cache"}


def text_files(*roots: str) -> list[Path]:
    result: list[Path] = []
    for root_name in roots:
        root = ROOT / root_name
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if path.is_file() and not any(part in IGNORED_PARTS for part in path.parts):
                result.append(path)
    return result


def normalize(path: Path) -> str:
    parts: list[str] = []
    for part in path.parts:
        if part in {"", "."}:
            continue
        if part == "..":
            if parts:
                parts.pop()
        else:
            parts.append(part)
    return "/".join(parts)


def resolve_import(source: str, specifier: str, available: set[str]) -> str | None:
    if specifier.startswith("@/"):
        base = Path("src") / specifier[2:]
    elif specifier.startswith("."):
        base = Path(source).parent / specifier
    else:
        return None

    candidates: list[Path] = []
    if base.suffix:
        candidates.append(base)
    else:
        for extension in SOURCE_EXTENSIONS:
            candidates.append(Path(f"{base}{extension}"))
        for extension in SOURCE_EXTENSIONS:
            candidates.append(base / f"index{extension}")
    for candidate in candidates:
        resolved = normalize(candidate)
        if resolved in available:
            return resolved
    return None


def remove_unreachable_source() -> list[str]:
    source_files = {
        path.relative_to(ROOT).as_posix(): path
        for path in text_files("src", "engine", "shared", "tests", "scripts")
        if path.suffix in SOURCE_EXTENSIONS
    }
    for config in ("vite.config.ts",):
        path = ROOT / config
        if path.exists():
            source_files[config] = path

    import_pattern = re.compile(
        r"(?:import|export)\s+(?:[^'\"]*?\s+from\s+)?['\"]([^'\"]+)['\"]"
        r"|import\(\s*['\"]([^'\"]+)['\"]\s*\)"
        r"|new\s+URL\(\s*['\"]([^'\"]+)['\"]"
    )
    graph: dict[str, set[str]] = {path: set() for path in source_files}
    for relative, path in source_files.items():
        text = path.read_text(encoding="utf-8")
        for match in import_pattern.finditer(text):
            specifier = next(group for group in match.groups() if group)
            resolved = resolve_import(relative, specifier, set(source_files))
            if resolved:
                graph[relative].add(resolved)

    entrypoints = [path for path in ("src/main.tsx", "vite.config.ts") if path in source_files]
    entrypoints.extend(
        path for path in source_files if path.startswith("tests/") or path.startswith("scripts/")
    )
    reachable: set[str] = set()
    stack = list(dict.fromkeys(entrypoints))
    while stack:
        current = stack.pop()
        if current in reachable:
            continue
        reachable.add(current)
        stack.extend(graph.get(current, ()))

    removed: list[str] = []
    for relative, path in source_files.items():
        if relative in reachable or relative.endswith(".d.ts"):
            continue
        if relative.startswith(("src/", "engine/", "shared/")):
            path.unlink()
            removed.append(relative)
    return sorted(removed)


def update_package_policy() -> None:
    path = ROOT / "package.json"
    package = json.loads(path.read_text(encoding="utf-8"))
    dependencies = package.setdefault("dependencies", {})
    development = package.setdefault("devDependencies", {})
    for name in ("@tailwindcss/vite", "tailwindcss"):
        if name in dependencies:
            development[name] = dependencies.pop(name)
    package.setdefault("overrides", {})["fast-csv"] = "5.0.7"
    path.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")


def remove_unused_icons() -> list[str]:
    config_path = ROOT / "src-tauri/tauri.conf.json"
    icon_root = ROOT / "src-tauri/icons"
    if not config_path.exists() or not icon_root.exists():
        return []
    config = json.loads(config_path.read_text(encoding="utf-8"))
    referenced: set[str] = set()

    def collect(value: object) -> None:
        if isinstance(value, dict):
            for nested in value.values():
                collect(nested)
        elif isinstance(value, list):
            for nested in value:
                collect(nested)
        elif isinstance(value, str) and re.search(r"\.(?:png|ico|icns|svg)$", value, re.I):
            referenced.add((ROOT / "src-tauri" / value).resolve().as_posix())

    collect(config)
    removed: list[str] = []
    for path in icon_root.rglob("*"):
        if path.is_file() and path.resolve().as_posix() not in referenced:
            removed.append(path.relative_to(ROOT).as_posix())
            path.unlink()
    for directory in sorted((path for path in icon_root.rglob("*") if path.is_dir()), reverse=True):
        try:
            directory.rmdir()
        except OSError:
            pass
    return sorted(removed)


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


def remove_function(text: str, name: str) -> tuple[str, bool]:
    pattern = re.compile(
        r"(?m)^[ \t]*#\[tauri::command\][ \t]*\n"
        r"(?:^[ \t]*#\[[^\n]+\][ \t]*\n)*"
        r"^[ \t]*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+"
        + re.escape(name)
        + r"\b"
    )
    match = pattern.search(text)
    if not match:
        return text, False
    opening = text.find("{", match.end())
    if opening < 0:
        return text, False
    end = matching_brace(text, opening)
    if end is None:
        return text, False
    while end < len(text) and text[end] in " \t":
        end += 1
    if end < len(text) and text[end] == "\n":
        end += 1
    if end < len(text) and text[end] == "\n":
        end += 1
    return text[: match.start()] + text[end:], True


def remove_unreferenced_commands() -> list[str]:
    rust_files = list((ROOT / "src-tauri/src").rglob("*.rs"))
    frontend_files = [
        path
        for path in text_files("src", "engine", "shared")
        if path.suffix in {".ts", ".tsx"}
    ]
    invoke_pattern = re.compile(r"\binvoke(?:<[^>]+>)?\(\s*['\"]([^'\"]+)['\"]")
    invoked: set[str] = set()
    for path in frontend_files:
        invoked.update(invoke_pattern.findall(path.read_text(encoding="utf-8")))

    command_pattern = re.compile(
        r"#\[tauri::command\][\s\S]{0,500}?"
        r"\b(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z0-9_]+)"
    )
    command_locations: list[tuple[Path, str]] = []
    all_rust = {path: path.read_text(encoding="utf-8") for path in rust_files}
    all_text = "\n".join(all_rust.values()) + "\n" + "\n".join(
        path.read_text(encoding="utf-8") for path in frontend_files
    )
    for path, text in all_rust.items():
        for name in command_pattern.findall(text):
            command_locations.append((path, name))

    removed: list[str] = []
    for path, name in command_locations:
        if name in invoked:
            continue
        if len(re.findall(rf"\b{re.escape(name)}\b", all_text)) > 4:
            continue
        text = path.read_text(encoding="utf-8")
        updated, changed = remove_function(text, name)
        if not changed:
            continue
        path.write_text(updated, encoding="utf-8")
        removed.append(name)
        for other in rust_files:
            source = other.read_text(encoding="utf-8")
            revised = re.sub(rf"(?m)^\s*(?:commands::)?{re.escape(name)}\s*,\s*\n", "", source)
            revised = re.sub(rf"\b{re.escape(name)}\s*,\s*", "", revised)
            if revised != source:
                other.write_text(revised, encoding="utf-8")
    return sorted(set(removed))


def add_sanitation_gate() -> None:
    path = ROOT / "scripts/verify-architecture.cjs"
    text = path.read_text(encoding="utf-8")
    if "// Deep sanitation invariants" in text:
        return
    gate = r'''

// Deep sanitation invariants
(() => {
  const { existsSync, readFileSync, readdirSync, statSync } = require('node:fs');
  const { join, relative } = require('node:path');
  const fail = (message) => { throw new Error(`Architecture sanitation failed: ${message}`); };
  const walk = (directory) => {
    if (!existsSync(directory)) return [];
    return readdirSync(directory).flatMap((name) => {
      const path = join(directory, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  };
  const forbiddenPaths = [
    'components.json',
    'src/boq-worker.ts',
    'src/components/ReviewPanel.tsx',
    'src/components/SettingsModal.tsx',
    'src/components/HistoryDrawer.tsx',
    'src/components/Onboarding.tsx',
    'src/components/ui/chart-legend.tsx',
    'src/components/ui/chart-tooltip.tsx',
    'src/components/ui/number-flow.tsx',
    'scripts/generate-icons.cjs',
    '.github/workflows/temporary-cleanup-workspace.yml',
    '.github/workflows/source-snapshot.yml',
    '.github/workflows/apply-deep-cleanup.yml',
    '.github/cleanup',
  ];
  const resurrected = forbiddenPaths.filter(existsSync);
  if (resurrected.length) fail(`legacy or temporary paths reintroduced: ${resurrected.join(', ')}`);

  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
  for (const tooling of ['@tailwindcss/vite', 'tailwindcss']) {
    if (packageJson.dependencies?.[tooling]) fail(`${tooling} must stay in devDependencies`);
  }
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const deprecated = Object.keys(lock.packages ?? {}).some((path) =>
    path === 'node_modules/lodash.isequal' || path.endsWith('/node_modules/lodash.isequal'));
  if (deprecated) fail('deprecated transitive dependency remains: lodash.isequal');

  const rustFiles = walk('src-tauri/src').filter((path) => path.endsWith('.rs'));
  const commands = new Set();
  const commandPattern = /#\[tauri::command\][\s\S]{0,500}?\b(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z0-9_]+)/g;
  for (const path of rustFiles) {
    const source = readFileSync(path, 'utf8');
    for (const match of source.matchAll(commandPattern)) commands.add(match[1]);
  }
  const frontendFiles = [...walk('src'), ...walk('engine'), ...walk('shared')]
    .filter((path) => /\.(?:ts|tsx)$/.test(path));
  const invokes = new Set();
  const invokePattern = /\binvoke(?:<[^>]+>)?\(\s*['"]([^'"]+)['"]/g;
  for (const path of frontendFiles) {
    const source = readFileSync(path, 'utf8');
    for (const match of source.matchAll(invokePattern)) invokes.add(match[1]);
  }
  const unusedCommands = [...commands].filter((name) => !invokes.has(name)).sort();
  const missingCommands = [...invokes].filter((name) => !commands.has(name)).sort();
  if (unusedCommands.length) fail(`Tauri commands have no frontend caller: ${unusedCommands.join(', ')}`);
  if (missingCommands.length) fail(`frontend invokes missing Tauri commands: ${missingCommands.join(', ')}`);

  const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
  const configuredIcons = new Set();
  const collectIcons = (value) => {
    if (Array.isArray(value)) return value.forEach(collectIcons);
    if (value && typeof value === 'object') return Object.values(value).forEach(collectIcons);
    if (typeof value === 'string' && /\.(?:png|ico|icns|svg)$/i.test(value)) {
      configuredIcons.add(relative('.', join('src-tauri', value)).replaceAll('\\', '/'));
    }
  };
  collectIcons(config);
  const trackedIcons = walk('src-tauri/icons').map((path) => relative('.', path).replaceAll('\\', '/'));
  const extraIcons = trackedIcons.filter((path) => !configuredIcons.has(path));
  if (extraIcons.length) fail(`unconfigured icon assets remain: ${extraIcons.join(', ')}`);
})();
'''
    path.write_text(text.rstrip() + gate + "\n", encoding="utf-8")


def remove_known_legacy() -> list[str]:
    removed: list[str] = []
    for relative in (
        "components.json",
        "scripts/generate-icons.cjs",
        "src/components/ui/chart-legend.tsx",
        "src/components/ui/chart-tooltip.tsx",
        "src/components/ui/number-flow.tsx",
    ):
        path = ROOT / relative
        if path.exists():
            if path.is_dir():
                shutil.rmtree(path)
            else:
                path.unlink()
            removed.append(relative)
    return removed


def main() -> None:
    report = {
        "legacy_paths": remove_known_legacy(),
        "unreachable_source": remove_unreachable_source(),
        "unused_icons": remove_unused_icons(),
        "unused_commands": remove_unreferenced_commands(),
    }
    update_package_policy()
    add_sanitation_gate()
    (ROOT / ".deep-cleanup-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
