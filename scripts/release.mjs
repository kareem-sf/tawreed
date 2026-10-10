// After `npm run package`: write SHA256SUMS.txt and the update feed (latest.json) beside the Windows installer and
// print the command that publishes them as a draft GitHub release. The feed is what installed apps read, at the
// address in desktop/tauri.release.conf.json; it points at the installer in a `v<version>/` folder beside itself.
// Release builds are made on the engineer's machine, because only there does the installer carry Thmanyah (its
// licence allows it only inside the compiled app). Publishing is left to them.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { root } from "./python.mjs";

const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
const folder = path.join(root, "desktop", "target", "release", "bundle", "nsis");
const installer = readdirSync(folder).find((name) => name.endsWith(".exe") && name.includes(version));
if (!installer) {
  console.error(`No installer for version ${version} in ${folder}. Run npm run package first.`);
  process.exit(1);
}

const digest = createHash("sha256").update(readFileSync(path.join(folder, installer))).digest("hex");
const sums = path.join(folder, "SHA256SUMS.txt");
writeFileSync(sums, `${digest}  ${installer}\n`);
const thmanyah = path.join(root, "ui", "src", "fonts", "thmanyah");
const fonts = existsSync(thmanyah) && readdirSync(thmanyah).some((name) => /\.(woff2|otf|ttf)$/.test(name));

console.log(`${installer}\n${digest}\n${fonts ? "Thmanyah is embedded." : "Thmanyah is NOT embedded: Arabic falls back to the system font."}`);
const updater = JSON.parse(readFileSync(path.join(root, "desktop", "tauri.release.conf.json"), "utf8")).plugins.updater;
const signature = path.join(folder, `${installer}.sig`);
if (!updater.pubkey) {
  console.log("\nNOT FOR RELEASE: no updater public key in desktop/tauri.release.conf.json, so this build can never update itself.");
} else if (!existsSync(signature)) {
  console.error(`\nNo ${installer}.sig. Set bundle.createUpdaterArtifacts to true and TAURI_SIGNING_PRIVATE_KEY, then run npm run package again.`);
  process.exit(1);
} else {
  const feed = {
    version,
    pub_date: new Date().toISOString(),
    platforms: {
      "windows-x86_64": {
        signature: readFileSync(signature, "utf8"),
        url: new URL(`v${version}/${encodeURIComponent(installer)}`, updater.endpoints[0]).href,
      },
    },
  };
  writeFileSync(path.join(folder, "latest.json"), `${JSON.stringify(feed, null, 2)}\n`);
  console.log(`\nUpdate feed: latest.json, for ${updater.endpoints[0]}\nIt offers the installer at ${feed.platforms["windows-x86_64"].url}`);
}

console.log(`\nTo publish a draft release:\n  gh release create v${version} --draft --title "Tawreed ${version}" \\\n    "${path.join(folder, installer)}" "${sums}"`);
