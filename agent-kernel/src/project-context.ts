import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { TextDecoder } from 'node:util';
import { projectIdSchema } from './protocol';

const PROJECT_RECORD = 'project.json';
const WORKSPACE_DIRECTORY = 'agent-workspace';
const MAX_PROJECT_RECORD_BYTES = 4_096;
const PROJECT_RECORD_KEYS = [
  'createdAtMs',
  'id',
  'name',
  'status',
  'updatedAtMs',
] as const;

export interface ProjectWorkspaceOptions {
  afterWorkspaceReady?: () => void | Promise<void>;
  afterProjectRecordRead?: (phase: 'initial' | 'final') => void | Promise<void>;
}

function fail(): never {
  throw new Error('project_context_invalid');
}

function normalizedForComparison(path: string): string {
  const normalized = resolve(path);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isContained(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

async function requireRealDirectory(path: string): Promise<string> {
  const metadata = await lstat(path).catch(fail);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) fail();
  const canonical = await realpath(path).catch(fail);
  const canonicalMetadata = await lstat(canonical).catch(fail);
  if (!canonicalMetadata.isDirectory() || canonicalMetadata.isSymbolicLink()) fail();
  return canonical;
}

async function readBoundedRegularFile(
  path: string,
  afterRead?: () => void | Promise<void>,
): Promise<Buffer> {
  const metadata = await lstat(path, { bigint: true }).catch(fail);
  if (!metadata.isFile() || metadata.isSymbolicLink()) fail();
  if (metadata.size > BigInt(MAX_PROJECT_RECORD_BYTES)) fail();
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
  const flags = constants.O_RDONLY | (process.platform === 'win32' ? 0 : noFollow);
  const handle = await open(path, flags).catch(fail);
  try {
    const opened = await handle.stat({ bigint: true }).catch(fail);
    if (
      !opened.isFile()
      || opened.size > BigInt(MAX_PROJECT_RECORD_BYTES)
      || opened.dev !== metadata.dev
      || opened.ino !== metadata.ino
    ) fail();
    const bytes = Buffer.allocUnsafe(MAX_PROJECT_RECORD_BYTES + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset).catch(fail);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    const openedAfterRead = await handle.stat({ bigint: true }).catch(fail);
    try {
      await afterRead?.();
    } catch {
      fail();
    }
    const pathAfterRead = await lstat(path, { bigint: true }).catch(fail);
    if (
      offset > MAX_PROJECT_RECORD_BYTES
      || openedAfterRead.size !== BigInt(offset)
      || openedAfterRead.dev !== opened.dev
      || openedAfterRead.ino !== opened.ino
      || !pathAfterRead.isFile()
      || pathAfterRead.isSymbolicLink()
      || pathAfterRead.size !== openedAfterRead.size
      || pathAfterRead.dev !== opened.dev
      || pathAfterRead.ino !== opened.ino
    ) fail();
    return Buffer.from(bytes.subarray(0, offset));
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function hasTooManyCharacters(value: string, maximum: number): boolean {
  if (value.length <= maximum) return false;
  let count = 0;
  const iterator = value[Symbol.iterator]();
  while (!iterator.next().done) {
    count += 1;
    if (count > maximum) return true;
  }
  return false;
}

function validTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

class StrictJsonParser {
  private index = 0;

  constructor(private readonly source: string) {}

  parse(): unknown {
    this.skipWhitespace();
    const value = this.parseValue(0);
    this.skipWhitespace();
    if (this.index !== this.source.length) fail();
    return value;
  }

  private parseValue(depth: number): unknown {
    if (depth > 64) fail();
    this.skipWhitespace();
    const character = this.source[this.index];
    if (character === '{') return this.parseObject(depth + 1);
    if (character === '[') return this.parseArray(depth + 1);
    if (character === '"') return this.parseString();
    if (character === 't') return this.parseLiteral('true', true);
    if (character === 'f') return this.parseLiteral('false', false);
    if (character === 'n') return this.parseLiteral('null', null);
    return this.parseNumber();
  }

  private parseObject(depth: number): Record<string, unknown> {
    this.index += 1;
    const result = Object.create(null) as Record<string, unknown>;
    const keys = new Set<string>();
    this.skipWhitespace();
    if (this.consume('}')) return result;
    while (true) {
      this.skipWhitespace();
      if (this.source[this.index] !== '"') fail();
      const key = this.parseString();
      if (keys.has(key)) fail();
      keys.add(key);
      this.skipWhitespace();
      if (!this.consume(':')) fail();
      result[key] = this.parseValue(depth);
      this.skipWhitespace();
      if (this.consume('}')) return result;
      if (!this.consume(',')) fail();
    }
  }

  private parseArray(depth: number): unknown[] {
    this.index += 1;
    const result: unknown[] = [];
    this.skipWhitespace();
    if (this.consume(']')) return result;
    while (true) {
      result.push(this.parseValue(depth));
      this.skipWhitespace();
      if (this.consume(']')) return result;
      if (!this.consume(',')) fail();
    }
  }

  private parseString(): string {
    const start = this.index;
    this.index += 1;
    while (this.index < this.source.length) {
      const character = this.source[this.index];
      this.index += 1;
      if (character === '\\') {
        if (this.index >= this.source.length) fail();
        this.index += 1;
      } else if (character === '"') {
        try {
          return JSON.parse(this.source.slice(start, this.index)) as string;
        } catch {
          fail();
        }
      }
    }
    fail();
  }

  private parseLiteral<T>(literal: string, value: T): T {
    if (this.source.slice(this.index, this.index + literal.length) !== literal) fail();
    this.index += literal.length;
    return value;
  }

  private parseNumber(): number {
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/
      .exec(this.source.slice(this.index));
    if (match === null) fail();
    this.index += match[0].length;
    return Number(match[0]);
  }

  private consume(character: string): boolean {
    if (this.source[this.index] !== character) return false;
    this.index += 1;
    return true;
  }

  private skipWhitespace(): void {
    while (
      this.source[this.index] === ' '
      || this.source[this.index] === '\t'
      || this.source[this.index] === '\r'
      || this.source[this.index] === '\n'
    ) this.index += 1;
  }
}

async function requireValidProjectRecord(
  path: string,
  expectedId: string,
  afterRead?: () => void | Promise<void>,
): Promise<void> {
  const bytes = await readBoundedRegularFile(path, afterRead);
  let value: unknown;
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    value = new StrictJsonParser(decoded).parse();
  } catch {
    fail();
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail();
  const keys = Object.keys(value).sort();
  if (
    keys.length !== PROJECT_RECORD_KEYS.length
    || keys.some((key, index) => key !== PROJECT_RECORD_KEYS[index])
  ) fail();
  const record = value as Record<string, unknown>;
  if (
    record.id !== expectedId
    || typeof record.name !== 'string'
    || record.name.length === 0
    || record.name !== record.name.trim()
    || hasTooManyCharacters(record.name, 160)
    || record.status !== 'active'
    || !validTimestamp(record.createdAtMs)
    || !validTimestamp(record.updatedAtMs)
    || record.createdAtMs > record.updatedAtMs
  ) fail();
}

export async function canonicalDataRoot(path: string): Promise<string> {
  if (typeof path !== 'string' || path.trim().length === 0) fail();
  return requireRealDirectory(path);
}

export function sameCanonicalPath(left: string, right: string): boolean {
  return normalizedForComparison(left) === normalizedForComparison(right);
}

export async function resolveProjectWorkspace(
  dataRoot: string,
  projectId: string,
  options: ProjectWorkspaceOptions = {},
): Promise<string> {
  if (!projectIdSchema.safeParse(projectId).success) fail();

  const canonicalRoot = await requireRealDirectory(dataRoot);
  const projectsPath = join(canonicalRoot, 'projects');
  const canonicalProjects = await requireRealDirectory(projectsPath);
  if (!isContained(canonicalRoot, canonicalProjects)) fail();

  const projectPath = join(canonicalProjects, projectId);
  const canonicalProject = await requireRealDirectory(projectPath);
  if (!isContained(canonicalProjects, canonicalProject)) fail();
  const projectRecord = join(canonicalProject, PROJECT_RECORD);
  await requireValidProjectRecord(
    projectRecord,
    projectId,
    options.afterProjectRecordRead === undefined
      ? undefined
      : () => options.afterProjectRecordRead?.('initial'),
  );

  const workspacePath = join(canonicalProject, WORKSPACE_DIRECTORY);
  const existing = await lstat(workspacePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    return fail();
  });
  if (existing === null) {
    const projectBeforeCreate = await requireRealDirectory(projectPath);
    if (!sameCanonicalPath(projectBeforeCreate, canonicalProject)) fail();
    await mkdir(workspacePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') fail();
    });
  } else if (!existing.isDirectory() || existing.isSymbolicLink()) {
    fail();
  }

  const canonicalWorkspace = await requireRealDirectory(workspacePath);
  const projectAfterCreate = await requireRealDirectory(projectPath);
  if (
    !sameCanonicalPath(projectAfterCreate, canonicalProject)
    || !isContained(canonicalProject, canonicalWorkspace)
    || relative(canonicalProject, canonicalWorkspace) !== WORKSPACE_DIRECTORY
  ) {
    fail();
  }
  try {
    await options.afterWorkspaceReady?.();
  } catch {
    fail();
  }
  const projectBeforeFinalRecord = await requireRealDirectory(projectPath);
  if (!sameCanonicalPath(projectBeforeFinalRecord, canonicalProject)) fail();
  await requireValidProjectRecord(
    projectRecord,
    projectId,
    options.afterProjectRecordRead === undefined
      ? undefined
      : () => options.afterProjectRecordRead?.('final'),
  );
  const projectAfterFinalRecord = await requireRealDirectory(projectPath);
  if (!sameCanonicalPath(projectAfterFinalRecord, canonicalProject)) fail();
  return canonicalWorkspace;
}
