import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { root, servicePython } from "./scripts/python.mjs";

// In development the Vite server starts the local service and forwards /api to it with the launch token,
// so the browser preview and the Tauri window reach the service the same way and never hold the token.
export default defineConfig(async ({ command }) => {
  const dev = command === "serve" && !process.env.VITEST;
  const port = dev ? await freePort() : 0;
  const token = randomBytes(32).toString("hex");

  return {
    root: "ui",
    plugins: [react(), tailwindcss(), ...(dev ? [service(port, token)] : [])],
    server: {
      port: 1430, // Quantix uses 1420; both can run side by side
      strictPort: true,
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${port}`,
          rewrite: (path: string) => path.replace(/^\/api/, ""),
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    build: { outDir: "../dist", emptyOutDir: true },
    test: {
      root: ".",
      environment: "jsdom",
      include: ["ui/src/**/*.test.{ts,tsx}"],
      setupFiles: ["ui/src/test-setup.ts"],
      testTimeout: 20000, // a busy machine or CI runner must not fail a correct test
    },
  };
});

function service(port: number, token: string): Plugin {
  let child: ChildProcess | undefined;
  return {
    name: "tawreed-service",
    configureServer(server) {
      child = spawn(servicePython(), ["-m", "tawreed", "--port", String(port)], {
        cwd: root,
        env: { ...process.env, TAWREED_TOKEN: token },
        stdio: "inherit",
      });
      child.on("exit", (code) => {
        if (code) server.config.logger.error(`Tawreed service stopped with code ${code}.`);
      });
      // On Windows the venv's python.exe is a launcher that starts the real interpreter as its own child,
      // so killing only the launcher would leave the service running. Stop the whole tree.
      const stop = () => {
        if (!child?.pid || child.exitCode !== null) return;
        if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        else child.kill();
      };
      server.httpServer?.on("close", stop);
      process.on("exit", stop);
      for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
        process.once(signal, () => {
          stop();
          process.exit(0);
        });
      }
    },
  };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => (typeof address === "object" && address ? resolve(address.port) : reject()));
    });
  });
}
