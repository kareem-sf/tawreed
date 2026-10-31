import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { checkVersions, prepareRelease } from "./release.mjs";

const version = "0.1.0";
const updater = { pubkey: "synthetic-public-key", endpoints: ["https://github.com/qs-mind/tawreed/releases/latest/download/latest.json"] };
const base = "https://github.com/qs-mind/tawreed/releases/download/v0.1.0";

const files = [
  { dir: "nsis", name: "Tawreed_0.1.0_x64-setup.exe", asset: "Tawreed_x64-setup.exe", platform: "windows-x86_64" },
  { dir: "appimage", name: "Tawreed_0.1.0_amd64.AppImage", asset: "Tawreed_amd64.AppImage", platform: "linux-x86_64" },
  { dir: "macos-aarch64", name: "Tawreed_0.1.0_aarch64.app.tar.gz", asset: "Tawreed_aarch64.app.tar.gz", platform: "darwin-aarch64" },
  { dir: "macos-x64", name: "Tawreed_0.1.0_x64.app.tar.gz", asset: "Tawreed_x64.app.tar.gz", platform: "darwin-x86_64" },
  { dir: "macos-aarch64", name: "Tawreed_0.1.0_aarch64.dmg", asset: "Tawreed_aarch64.dmg" },
  { dir: "macos-x64", name: "Tawreed_0.1.0_x64.dmg", asset: "Tawreed_x64.dmg" },
];

// What `tauri signer sign --app-version` writes: the base64 of a minisign file whose signed comment names the version.
const sign = (name, signedFor = version) =>
  Buffer.from(`untrusted comment: signature from tauri secret key\nsynthetic\ntrusted comment: timestamp:1\tfile:${name}\tversion:${signedFor}\nsynthetic\n`).toString("base64");

function scratch(t) {
  const folder = mkdtempSync(path.join(tmpdir(), "release-test-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}

function bundle(t, { omit = [], signatures = true } = {}) {
  const folder = scratch(t);
  for (const { dir, name } of files) {
    if (omit.includes(name)) continue;
    mkdirSync(path.join(folder, dir), { recursive: true });
    const file = path.join(folder, dir, name);
    writeFileSync(file, `synthetic ${name}`);
    if (signatures && !name.endsWith(".dmg")) writeFileSync(`${file}.sig`, `${sign(name)}\n`);
  }
  return folder;
}

const sigPath = (folder, name) => path.join(folder, files.find((file) => file.name === name).dir, `${name}.sig`);

test("combined feed carries all four platforms with URLs and signatures", (t) => {
  const folder = bundle(t);
  const { feed } = prepareRelease(folder, version, updater);
  assert.deepEqual(
    feed.platforms,
    Object.fromEntries(files.filter((file) => file.platform).map((file) => [file.platform, { signature: sign(file.name), url: `${base}/${file.asset}` }])),
  );
  assert.deepEqual(JSON.parse(readFileSync(path.join(folder, "latest.json"))), feed);
});

test("every file, DMGs included, is checksummed and copied under the name the site links to", (t) => {
  const folder = bundle(t);
  prepareRelease(folder, version, updater);
  const sums = readFileSync(path.join(folder, "SHA256SUMS.txt"), "utf8");
  for (const { name, asset } of files) {
    assert.ok(sums.includes(`${createHash("sha256").update(`synthetic ${name}`).digest("hex")}  ${asset}\n`), asset);
    assert.equal(readFileSync(path.join(folder, asset), "utf8"), `synthetic ${name}`);
  }
});

test("DMGs are in the checksums but never in the update feed", (t) => {
  const folder = bundle(t);
  const { feed } = prepareRelease(folder, version, updater);
  const text = readFileSync(path.join(folder, "latest.json"), "utf8");
  assert.equal(text.includes(".dmg"), false);
  assert.equal(Object.keys(feed.platforms).length, 4);
  assert.ok(readFileSync(path.join(folder, "SHA256SUMS.txt"), "utf8").includes("Tawreed_aarch64.dmg"));
});

test("a missing or empty signature on any platform leaves an existing feed untouched", (t) => {
  for (const { name } of files.filter((file) => file.platform)) {
    for (const empty of [false, true]) {
      const folder = bundle(t);
      writeFileSync(path.join(folder, "latest.json"), "saved feed");
      if (empty) writeFileSync(sigPath(folder, name), "\n"); else rmSync(sigPath(folder, name));
      assert.throws(() => prepareRelease(folder, version, updater), /(?:No|Empty) .*\.sig/, name);
      assert.equal(readFileSync(path.join(folder, "latest.json"), "utf8"), "saved feed");
    }
  }
});

test("a missing macOS signature is refused", (t) => {
  const folder = bundle(t);
  rmSync(sigPath(folder, "Tawreed_0.1.0_aarch64.app.tar.gz"));
  assert.throws(() => prepareRelease(folder, version, updater), /No Tawreed_0\.1\.0_aarch64\.app\.tar\.gz\.sig/);
});

test("a signature made for another version is refused", (t) => {
  for (const { name } of files.filter((file) => file.platform)) {
    const folder = bundle(t);
    writeFileSync(path.join(folder, "latest.json"), "saved feed");
    writeFileSync(sigPath(folder, name), sign(name, "0.0.9"));
    assert.throws(() => prepareRelease(folder, version, updater), /not signed for version 0\.1\.0/, name);
    assert.equal(readFileSync(path.join(folder, "latest.json"), "utf8"), "saved feed");
  }
  const folder = bundle(t);
  writeFileSync(sigPath(folder, "Tawreed_0.1.0_amd64.AppImage"), Buffer.from("no version in here").toString("base64"));
  assert.throws(() => prepareRelease(folder, version, updater), /not signed for version/);
});

test("a partial build cannot replace the combined feed", (t) => {
  for (const omit of [["Tawreed_0.1.0_aarch64.app.tar.gz"], ["Tawreed_0.1.0_x64.dmg"], ["Tawreed_0.1.0_amd64.AppImage"]]) {
    const folder = bundle(t, { omit });
    writeFileSync(path.join(folder, "latest.json"), "saved combined feed");
    assert.throws(() => prepareRelease(folder, version, updater), /All four platforms/);
    assert.equal(readFileSync(path.join(folder, "latest.json"), "utf8"), "saved combined feed");
  }
});

test("no public key prepares checksums for a local package but creates no feed", (t) => {
  const folder = bundle(t, { omit: files.slice(1).map((file) => file.name), signatures: false });
  assert.equal(prepareRelease(folder, version, { ...updater, pubkey: "" }).feed, null);
  assert.ok(existsSync(path.join(folder, "SHA256SUMS.txt")));
  assert.equal(existsSync(path.join(folder, "latest.json")), false);
});

test("wrong version and unsupported architecture are not advertised", (t) => {
  const folder = bundle(t, { omit: files.slice(1).map((file) => file.name) });
  assert.throws(() => prepareRelease(folder, "0.2.0", updater), /No artifacts/);
  rmSync(path.join(folder, "nsis", "Tawreed_0.1.0_x64-setup.exe"));
  writeFileSync(path.join(folder, "nsis", "Tawreed_0.1.0_arm64-setup.exe"), "synthetic ARM");
  assert.throws(() => prepareRelease(folder, version, updater), /No artifacts/);
});

function tree(t, versions = {}) {
  const v = (key) => versions[key] ?? version;
  const folder = scratch(t);
  const put = (file, text) => {
    mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
    writeFileSync(path.join(folder, file), text);
  };
  put("package.json", JSON.stringify({ name: "tawreed", version: v("package") }));
  put("package-lock.json", JSON.stringify({ name: "tawreed", version: v("lock"), packages: { "": { name: "tawreed", version: v("lockRoot") }, "node_modules/x": { version: "9.9.9" } } }));
  put("desktop/Cargo.toml", `[package]\nname = "tawreed-desktop"\nversion = "${v("cargo")}"\nedition = "2024"\n`);
  put("desktop/Cargo.lock", `[[package]]\nname = "other"\nversion = "9.9.9"\n\n[[package]]\nname = "tawreed-desktop"\nversion = "${v("cargoLock")}"\n`);
  put("desktop/tauri.conf.json", JSON.stringify({ version: v("tauri") }));
  put("service/pyproject.toml", `[project]\nname = "tawreed"\nversion = "${v("pyproject")}"\n`);
  put("service/tawreed/__init__.py", `__version__ = "${v("init")}"\n`);
  return folder;
}

test("the version must agree in every file", (t) => {
  checkVersions(tree(t), version);
  for (const key of ["package", "lock", "lockRoot", "cargo", "cargoLock", "tauri", "pyproject", "init"]) {
    assert.throws(() => checkVersions(tree(t, { [key]: "0.0.9" }), version), /0\.0\.9/, key);
  }
});

test("a file with no readable version is refused", (t) => {
  const folder = tree(t);
  rmSync(path.join(folder, "service", "tawreed", "__init__.py"));
  assert.throws(() => checkVersions(folder, version), /__init__\.py: not found/);
});
