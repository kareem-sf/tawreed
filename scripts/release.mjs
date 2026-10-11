// Prepare local release files only. Collect native Windows/Linux builds in one bundle folder before making a feed.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { root } from "./python.mjs";

const targets = [
  { folder: "nsis", platform: "windows-x86_64", suffix: "_x64-setup.exe" },
  { folder: "appimage", platform: "linux-x86_64", suffix: "_amd64.AppImage" },
];

export function prepareRelease(folder, version, updater) {
  const artifacts = targets.flatMap((target) => {
    const directory = path.join(folder, target.folder);
    const names = existsSync(directory) ? readdirSync(directory).filter((name) => name.endsWith(`_${version}${target.suffix}`)) : [];
    if (names.length > 1) throw new Error(`More than one ${target.platform} artifact for ${version}. Use a clean bundle folder.`);
    return names.map((name) => ({ ...target, name, file: path.join(directory, name) }));
  });
  if (!artifacts.length) throw new Error(`No x64 artifacts for ${version} in ${folder}. Run npm run package first.`);
  const sums = artifacts.map(({ file, name }) => `${createHash("sha256").update(readFileSync(file)).digest("hex")}  ${name}`).join("\n") + "\n";
  if (!updater.pubkey) {
    writeFileSync(path.join(folder, "SHA256SUMS.txt"), sums);
    return { artifacts, feed: null };
  }
  // Never overwrite the combined feed with a single-platform build or an unsigned artifact.
  if (artifacts.length !== targets.length) throw new Error("Both Windows NSIS and Linux AppImage builds are required for latest.json. Collect them in nsis/ and appimage/ first.");
  const platforms = Object.fromEntries(artifacts.map(({ file, name, platform }) => {
    if (!existsSync(`${file}.sig`)) throw new Error(`No ${name}.sig. Enable createUpdaterArtifacts and set TAURI_SIGNING_PRIVATE_KEY, then rebuild.`);
    const signature = readFileSync(`${file}.sig`, "utf8").trim();
    if (!signature) throw new Error(`Empty ${name}.sig. Rebuild and sign the artifact.`);
    return [platform, { signature, url: new URL(`v${version}/${encodeURIComponent(name)}`, updater.endpoints[0]).href }];
  }));
  const feed = { version, pub_date: new Date().toISOString(), platforms };
  writeFileSync(path.join(folder, "SHA256SUMS.txt"), sums);
  writeFileSync(path.join(folder, "latest.json"), `${JSON.stringify(feed, null, 2)}\n`);
  return { artifacts, feed };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
    const folder = path.resolve(process.argv[2] ?? path.join(root, "desktop", "target", "release", "bundle"));
    const updater = JSON.parse(readFileSync(path.join(root, "desktop", "tauri.release.conf.json"), "utf8")).plugins.updater;
    const { artifacts, feed } = prepareRelease(folder, version, updater);
    console.log(artifacts.map(({ file }) => file).join("\n"));
    console.log(`SHA256SUMS.txt: ${folder}`);
    const fonts = path.join(root, "ui", "src", "fonts", "thmanyah");
    console.log(existsSync(fonts) && readdirSync(fonts).some((name) => /\.(woff2|otf|ttf)$/.test(name)) ? "Thmanyah is present on this machine. Check each native build embeds it." : "Thmanyah is NOT present: Arabic falls back to the system font.");
    console.log(feed ? `Combined update feed: ${path.join(folder, "latest.json")}\nUpload both artifacts and their signatures to v${version}/; upload latest.json last. Publishing requires separate approval.` : "NOT FOR RELEASE: no updater public key. No update feed was generated. Do not publish an old latest.json from this folder.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
