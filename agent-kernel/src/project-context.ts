import { lstat, mkdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { projectIdSchema } from './protocol';

const PROJECT_RECORD = 'project.json';
const WORKSPACE_DIRECTORY = 'agent-workspace';

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

async function requireRegularFile(path: string): Promise<void> {
  const metadata = await lstat(path).catch(fail);
  if (!metadata.isFile() || metadata.isSymbolicLink()) fail();
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
): Promise<string> {
  if (!projectIdSchema.safeParse(projectId).success) fail();

  const canonicalRoot = await requireRealDirectory(dataRoot);
  const projectsPath = join(canonicalRoot, 'projects');
  const canonicalProjects = await requireRealDirectory(projectsPath);
  if (!isContained(canonicalRoot, canonicalProjects)) fail();

  const projectPath = join(canonicalProjects, projectId);
  const canonicalProject = await requireRealDirectory(projectPath);
  if (!isContained(canonicalProjects, canonicalProject)) fail();
  await requireRegularFile(join(canonicalProject, PROJECT_RECORD));

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
  return canonicalWorkspace;
}
