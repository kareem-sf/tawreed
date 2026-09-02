// Minimal Node surface used by the evaluation harness. The repo deliberately avoids a
// full @types/node dependency (see node-fs.d.ts / node-url.d.ts); declare only what is
// actually used so an unintended Node API cannot creep into engine or src code.
declare module 'node:fs/promises' {
  export function readFile(path: URL | string, encoding: 'utf8'): Promise<string>;
  export function readFile(path: URL | string): Promise<Uint8Array>;
  export function readdir(path: URL | string): Promise<string[]>;
}

declare module 'node:path' {
  export function join(...segments: string[]): string;
}

declare const process: {
  readonly env: Record<string, string | undefined>;
  readonly platform: string;
};
