import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const tauriConfigPath = path.join(
  repoRoot,
  "desktop",
  "src-tauri",
  "tauri.conf.json",
);
const packageJsonPath = path.join(repoRoot, "desktop", "package.json");
const releaseWorkflowPath = path.join(
  repoRoot,
  ".github",
  "workflows",
  "desktop-release.yml",
);
const targetReleasePath = path.join(
  repoRoot,
  "desktop",
  "src-tauri",
  "target",
  "release",
);

const errors = [];
const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, "utf8"));
const bundle = tauriConfig.bundle ?? {};
if (!Array.isArray(bundle.targets) || bundle.targets.length !== 0) {
  errors.push(
    "Tauri bundle.targets must stay [] so `tauri build` cannot create installers.",
  );
}
if (Object.hasOwn(bundle, "externalBin")) {
  errors.push(
    "Tauri externalBin must stay disabled; the engine is embedded in the portable host.",
  );
}

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const nativeBuild = packageJson.scripts?.["tauri:build"] ?? "";
if (!nativeBuild.includes("--no-bundle")) {
  errors.push("The default tauri:build script must use --no-bundle.");
}

const workflow = fs.readFileSync(releaseWorkflowPath, "utf8").toLowerCase();
for (const target of ["nsis", "msi", "deb", "rpm", "dmg", "app"]) {
  if (new RegExp(`--bundles[^\\n]*\\b${target}\\b`).test(workflow)) {
    errors.push(`Release workflow enables forbidden bundle target: ${target}.`);
  }
}

for (const marker of [
  ".zip",
  ".tar",
  "compress-archive",
  "actions/upload-artifact",
  "actions/download-artifact",
  "tauri-apps/tauri-action",
]) {
  if (workflow.includes(marker)) {
    errors.push(
      `Release workflow contains forbidden archive/packaging marker: ${marker}.`,
    );
  }
}

if (
  !workflow.includes("--no-bundle") ||
  !workflow.includes("--bundles appimage")
) {
  errors.push(
    "Release workflow must build raw hosts and the portable Linux AppImage only.",
  );
}
if (!workflow.includes("gh release upload")) {
  errors.push(
    "Portable executables must be uploaded directly with gh release upload.",
  );
}

// Tauri can leave packaging recipes behind even after installer targets are
// disabled. Treat those directories as release-policy failures too, so stale
// NSIS/WiX/macOS package output can never be mistaken for a portable build.
for (const directory of ["nsis", "wix"]) {
  const outputPath = path.join(targetReleasePath, directory);
  if (fs.existsSync(outputPath)) {
    errors.push(
      `Forbidden installer output exists: ${path.relative(repoRoot, outputPath)}.`,
    );
  }
}

const bundleOutputPath = path.join(targetReleasePath, "bundle");
if (fs.existsSync(bundleOutputPath)) {
  for (const entry of fs.readdirSync(bundleOutputPath, {
    withFileTypes: true,
  })) {
    if (entry.name.toLowerCase() !== "appimage") {
      errors.push(
        `Forbidden package output exists: ${path.relative(repoRoot, path.join(bundleOutputPath, entry.name))}.`,
      );
    }
  }
}

if (errors.length > 0) {
  throw new Error(`Portable-only policy failed:\n- ${errors.join("\n- ")}`);
}

console.log("Portable-only release policy passed.");
