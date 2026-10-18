import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { prepareRelease } from "./release.mjs";

const version = "0.1.0";
const updater = { pubkey: "synthetic-public-key", endpoints: ["https://github.com/qs-mind/tawreed-releases/releases/latest/download/latest.json"] };
function bundle(t, { linux = true, signatures = true } = {}) {
  const folder = mkdtempSync(path.join(process.env.PAPERCLIP_RUN_SCRATCH_DIR ?? process.cwd(), "release-test-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  for (const [directory, name] of [["nsis", "Tawreed_0.1.0_x64-setup.exe"], ...(linux ? [["appimage", "Tawreed_0.1.0_amd64.AppImage"]] : [])]) {
    mkdirSync(path.join(folder, directory));
    const file = path.join(folder, directory, name);
    writeFileSync(file, `synthetic ${directory}`);
    if (signatures) writeFileSync(`${file}.sig`, `synthetic ${directory} signature\n`);
  }
  return folder;
}

test("combined feed carries Windows and Linux URLs, signatures and artifact hashes", (t) => {
  const folder = bundle(t);
  const { feed } = prepareRelease(folder, version, updater);
  assert.deepEqual(feed.platforms, {
    "windows-x86_64": { signature: "synthetic nsis signature", url: "https://github.com/qs-mind/tawreed-releases/releases/download/v0.1.0/Tawreed_x64-setup.exe" },
    "linux-x86_64": { signature: "synthetic appimage signature", url: "https://github.com/qs-mind/tawreed-releases/releases/download/v0.1.0/Tawreed_amd64.AppImage" },
  });
  assert.deepEqual(JSON.parse(readFileSync(path.join(folder, "latest.json"))), feed);
  for (const [data, name] of [["synthetic nsis", "Tawreed_x64-setup.exe"], ["synthetic appimage", "Tawreed_amd64.AppImage"]]) {
    assert.ok(readFileSync(path.join(folder, "SHA256SUMS.txt"), "utf8").includes(`${createHash("sha256").update(data).digest("hex")}  ${name}\n`));
    assert.equal(readFileSync(path.join(folder, name), "utf8"), data); // the file to upload, under the name the site links to
  }
});

test("missing or empty signature on either platform leaves an existing feed untouched", (t) => {
  for (const directory of ["nsis", "appimage"]) {
    for (const empty of [false, true]) {
      const folder = bundle(t);
      writeFileSync(path.join(folder, "latest.json"), "saved feed");
      const name = directory === "nsis" ? "Tawreed_0.1.0_x64-setup.exe" : "Tawreed_0.1.0_amd64.AppImage";
      const sig = path.join(folder, directory, `${name}.sig`);
      if (empty) writeFileSync(sig, "\n"); else rmSync(sig);
      assert.throws(() => prepareRelease(folder, version, updater), /(?:No|Empty) .*\.sig/);
      assert.equal(readFileSync(path.join(folder, "latest.json"), "utf8"), "saved feed");
    }
  }
});

test("single-platform input cannot replace the combined feed", (t) => {
  const folder = bundle(t, { linux: false });
  writeFileSync(path.join(folder, "latest.json"), "saved combined feed");
  assert.throws(() => prepareRelease(folder, version, updater), /Both Windows NSIS and Linux AppImage/);
  assert.equal(readFileSync(path.join(folder, "latest.json"), "utf8"), "saved combined feed");
});

test("no public key prepares checksums for a local package but creates no feed", (t) => {
  const folder = bundle(t, { linux: false, signatures: false });
  assert.equal(prepareRelease(folder, version, { ...updater, pubkey: "" }).feed, null);
  assert.ok(existsSync(path.join(folder, "SHA256SUMS.txt")));
  assert.equal(existsSync(path.join(folder, "latest.json")), false);
});

test("wrong version and unsupported architecture are not advertised", (t) => {
  const folder = bundle(t, { linux: false });
  assert.throws(() => prepareRelease(folder, "0.2.0", updater), /No x64 artifacts/);
  rmSync(path.join(folder, "nsis", "Tawreed_0.1.0_x64-setup.exe"));
  writeFileSync(path.join(folder, "nsis", "Tawreed_0.1.0_arm64-setup.exe"), "synthetic ARM");
  assert.throws(() => prepareRelease(folder, version, updater), /No x64 artifacts/);
});
