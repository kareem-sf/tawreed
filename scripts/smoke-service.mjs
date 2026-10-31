// Start a frozen tawreed-service on a free port, check that it answers, and check that it stops when stdin closes.
// Usage: node scripts/smoke-service.mjs <path to tawreed-service[.exe]>
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function main(program) {
  const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
  const home = mkdtempSync(path.join(tmpdir(), "tawreed-smoke-"));
  const port = await freePort();
  const token = "smoke-test-token";
  const child = spawn(program, ["--port", String(port), "--exit-with-stdin"], {
    env: { ...process.env, TAWREED_TOKEN: token, TAWREED_HOME: home },
    stdio: ["pipe", "ignore", "inherit"],
  });
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
  const url = `http://127.0.0.1:${port}`;
  try {
    let up = false;
    for (let attempt = 0; attempt < 120 && !up; attempt++) {
      try {
        up = (await fetch(`${url}/health`)).ok;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    if (!up) throw new Error("The service did not answer /health within 60 seconds.");
    // /about needs the token, so this also proves the token is read and the data home works.
    const about = await (await fetch(`${url}/about`, { headers: { Authorization: `Bearer ${token}` } })).json();
    if (about.version !== version) throw new Error(`The service reports version ${about.version}, expected ${version}.`);
    if ((await fetch(`${url}/about`)).status !== 401) throw new Error("/about answered without the token.");
    child.stdin.end();
    const code = await Promise.race([exited, new Promise((resolve) => setTimeout(() => resolve("timeout"), 15000))]);
    if (code !== 0) throw new Error(`The service did not exit cleanly when stdin closed (${code}).`);
    console.log(`Frozen service OK: version ${about.version}, answered on port ${port}, stopped with stdin.`);
  } finally {
    child.kill();
    rmSync(home, { recursive: true, force: true });
  }
}

main(process.argv[2]).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
