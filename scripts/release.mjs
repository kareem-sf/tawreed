// Prepare local release files only. Collect native builds of every platform in one bundle folder before making a feed.
// The files to upload get names without the version, so the site's buttons can always link to the latest release.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { root } from "./python.mjs";

// One row per file of a release. `feed: true` rows are what the updater installs (each needs a signature);
// the others are download-only assets that still get a checksum. The macOS updater file is the zipped app,
// the DMG is only for a first install.
export const targets = [
  { folder: "nsis", platform: "windows-x86_64", suffix: "_x64-setup.exe", asset: "Tawreed_x64-setup.exe", feed: true },
  { folder: "appimage", platform: "linux-x86_64", suffix: "_amd64.AppImage", asset: "Tawreed_amd64.AppImage", feed: true },
  { folder: "macos-aarch64", platform: "darwin-aarch64", suffix: "_aarch64.app.tar.gz", asset: "Tawreed_aarch64.app.tar.gz", feed: true },
  { folder: "macos-x64", platform: "darwin-x86_64", suffix: "_x64.app.tar.gz", asset: "Tawreed_x64.app.tar.gz", feed: true },
  { folder: "macos-aarch64", platform: "darwin-aarch64-dmg", suffix: "_aarch64.dmg", asset: "Tawreed_aarch64.dmg", feed: false },
  { folder: "macos-x64", platform: "darwin-x86_64-dmg", suffix: "_x64.dmg", asset: "Tawreed_x64.dmg", feed: false },
];

// The version lives in these files; a release is refused unless they all agree.
const versionFields = [
  ["package.json", (text) => JSON.parse(text).version],
  ["package-lock.json", (text) => JSON.parse(text).version],
  ["package-lock.json (root package)", (text) => JSON.parse(text).packages[""].version, "package-lock.json"],
  ["desktop/Cargo.toml", (text) => text.match(/^version\s*=\s*"([^"]+)"/m)?.[1]],
  ["desktop/Cargo.lock (tawreed-desktop)", (text) => text.match(/\[\[package\]\]\r?\nname = "tawreed-desktop"\r?\nversion = "([^"]+)"/)?.[1], "desktop/Cargo.lock"],
  ["desktop/tauri.conf.json", (text) => JSON.parse(text).version],
  ["service/pyproject.toml", (text) => text.match(/^version\s*=\s*"([^"]+)"/m)?.[1]],
  ["service/tawreed/__init__.py", (text) => text.match(/^__version__\s*=\s*"([^"]+)"/m)?.[1]],
];

export function checkVersions(base, version) {
  const wrong = versionFields.flatMap(([label, read, file = label]) => {
    let found;
    try {
      found = read(readFileSync(path.join(base, file), "utf8"));
    } catch {
      found = undefined;
    }
    return found === version ? [] : [`${label}: ${found ?? "not found"}`];
  });
  if (wrong.length) throw new Error(`The version must be ${version} everywhere. Not in:\n${wrong.join("\n")}`);
}

// A signature made with `tauri signer sign --app-version <version>` carries that version in its signed comment,
// so an installer signed for another version cannot be passed off as this one.
function signedVersion(signature, version, name) {
  const text = Buffer.from(signature, "base64").toString("utf8");
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`(?:^|[\\s:,;])version:${escaped}(?:[\\s,;]|$)`).test(text)) {
    throw new Error(`${name}.sig was not signed for version ${version}. Sign with: tauri signer sign --app-version ${version}`);
  }
}

export function prepareRelease(folder, version, updater) {
  const artifacts = targets.flatMap((target) => {
    const directory = path.join(folder, target.folder);
    const names = existsSync(directory) ? readdirSync(directory).filter((name) => name.endsWith(`_${version}${target.suffix}`)) : [];
    if (names.length > 1) throw new Error(`More than one ${target.platform} artifact for ${version}. Use a clean bundle folder.`);
    return names.map((name) => ({ ...target, name, file: path.join(directory, name) }));
  });
  if (!artifacts.length) throw new Error(`No artifacts for ${version} in ${folder}. Run npm run package first.`);
  for (const { file, asset } of artifacts) copyFileSync(file, path.join(folder, asset));
  const sums = artifacts.map(({ file, asset }) => `${createHash("sha256").update(readFileSync(file)).digest("hex")}  ${asset}`).join("\n") + "\n";
  if (!updater.pubkey) {
    writeFileSync(path.join(folder, "SHA256SUMS.txt"), sums);
    return { artifacts, feed: null };
  }
  // Never overwrite the combined feed with a partial build or an unsigned artifact.
  if (artifacts.length !== targets.length) {
    const missing = targets.filter((target) => !artifacts.some((artifact) => artifact.asset === target.asset)).map((target) => target.asset);
    throw new Error(`All four platforms (Windows, Linux, macOS Apple Silicon and Intel) and both DMGs are required for latest.json. Missing: ${missing.join(", ")}.`);
  }
  const platforms = Object.fromEntries(artifacts.filter(({ feed }) => feed).map(({ file, name, platform, asset }) => {
    if (!existsSync(`${file}.sig`)) throw new Error(`No ${name}.sig. Sign the artifact with the updater private key first.`);
    const signature = readFileSync(`${file}.sig`, "utf8").trim();
    if (!signature) throw new Error(`Empty ${name}.sig. Sign the artifact again.`);
    signedVersion(signature, version, name);
    // The feed is the latest GitHub release's latest.json; each installer is an asset of its own release, v<version>
    return [platform, { signature, url: new URL(`../../download/v${version}/${asset}`, updater.endpoints[0]).href }];
  }));
  const feed = { version, pub_date: new Date().toISOString(), platforms };
  writeFileSync(path.join(folder, "SHA256SUMS.txt"), sums);
  writeFileSync(path.join(folder, "latest.json"), `${JSON.stringify(feed, null, 2)}\n`);
  return { artifacts, feed };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
    checkVersions(root, version);
    const folder = path.resolve(process.argv[2] ?? path.join(root, "desktop", "target", "release", "bundle"));
    const updater = JSON.parse(readFileSync(path.join(root, "desktop", "tauri.release.conf.json"), "utf8")).plugins.updater;
    const { artifacts, feed } = prepareRelease(folder, version, updater);
    console.log(artifacts.map(({ file }) => file).join("\n"));
    console.log(`SHA256SUMS.txt: ${folder}`);
    const fonts = path.join(root, "ui", "src", "fonts", "thmanyah");
    console.log(existsSync(fonts) && readdirSync(fonts).some((name) => /\.(woff2|otf|ttf)$/.test(name)) ? "Thmanyah is present on this machine. Check each native build embeds it." : "Thmanyah is NOT present: Arabic uses the bundled IBM Plex Sans Arabic fallback, as in every GitHub-built release. Never upload the Thmanyah files.");
    console.log(feed ? `Combined update feed: ${path.join(folder, "latest.json")}\nUpload ${artifacts.map(({ asset }) => asset).join(", ")}, SHA256SUMS.txt and latest.json to a GitHub release v${version} of qs-mind/tawreed. Publishing requires separate approval.` : "NOT FOR RELEASE: no updater public key. No update feed was generated. Do not publish an old latest.json from this folder.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
