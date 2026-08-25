#!/usr/bin/env node

import { generateKeyPairSync, createHash } from 'node:crypto';
import {
  chmod,
  mkdir,
  open,
  realpath,
  rm,
  rmdir,
  stat,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const usage =
  'Usage: node scripts/generate-runtime-keypair.mjs <output-directory>';

const windowsAclScript = String.raw`
$ErrorActionPreference = 'Stop'
$target = $env:TAWREED_ACL_TARGET
$isDirectory = $env:TAWREED_ACL_DIRECTORY -eq 'true'
$current = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$grant = if ($isDirectory) {
  "*$($current.Value):(OI)(CI)F"
} else {
  "*$($current.Value):F"
}
& icacls.exe $target '/inheritance:r' '/grant:r' $grant | Out-Null
if ($LASTEXITCODE -ne 0) { throw "icacls failed with exit code $LASTEXITCODE" }

$verified = Get-Acl -LiteralPath $target
$rules = @($verified.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
if (-not $verified.AreAccessRulesProtected) { throw 'ACL inheritance is enabled' }
if ($verified.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $current.Value) { throw 'Owner mismatch' }
if ($rules.Count -ne 1) { throw 'Unexpected ACL rule count' }
if ($rules[0].IdentityReference.Value -ne $current.Value) { throw 'Unexpected ACL identity' }
if ($rules[0].AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { throw 'Unexpected ACL type' }
if (($rules[0].FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -ne [System.Security.AccessControl.FileSystemRights]::FullControl) { throw 'Insufficient ACL rights' }
if ($isDirectory) {
  $requiredInheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
  if (($rules[0].InheritanceFlags -band $requiredInheritance) -ne $requiredInheritance) { throw 'Directory ACL is not inherited by children' }
} elseif ($rules[0].InheritanceFlags -ne [System.Security.AccessControl.InheritanceFlags]::None) {
  throw 'Private-key ACL unexpectedly inherits to children'
}
`;

function pathIsInside(parent, candidate) {
  const pathFromParent = relative(parent, candidate);
  return (
    pathFromParent === '' ||
    (!pathFromParent.startsWith(`..${sep}`) &&
      pathFromParent !== '..' &&
      !isAbsolute(pathFromParent))
  );
}

function isUnsafeWindowsAlias(path) {
  if (process.platform !== 'win32') {
    return false;
  }
  const windowsPath = path.replaceAll('/', '\\');
  const upperPath = windowsPath.toUpperCase();
  return (
    windowsPath.startsWith('\\\\') ||
    upperPath.startsWith('\\??\\') ||
    upperPath.startsWith('\\DEVICE\\') ||
    upperPath.startsWith('\\GLOBAL??\\')
  );
}

async function nearestExistingAncestor(path) {
  let candidate = path;
  const missingComponents = [];
  while (true) {
    try {
      await stat(candidate, { bigint: true });
      return { path: candidate, missingComponents };
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
      const parent = dirname(candidate);
      if (parent === candidate) {
        throw error;
      }
      missingComponents.unshift(basename(candidate));
      candidate = parent;
    }
  }
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function ancestorChainContainsIdentity(start, expectedIdentity) {
  let candidate = start;
  while (true) {
    const identity = await stat(candidate, { bigint: true });
    if (sameIdentity(identity, expectedIdentity)) {
      return true;
    }
    const parent = dirname(candidate);
    if (parent === candidate) {
      return false;
    }
    candidate = parent;
  }
}

function outsideRepositoryError() {
  return new Error('Output directory must be outside the repository');
}

async function assertOutsideRepository(
  candidate,
  canonicalRepository,
  repositoryIdentity,
) {
  const nearest = await nearestExistingAncestor(candidate);
  const canonicalAncestor = await realpath(nearest.path);
  const canonicalCandidate = resolve(
    canonicalAncestor,
    ...nearest.missingComponents,
  );
  if (
    pathIsInside(canonicalRepository, canonicalCandidate) ||
    (await ancestorChainContainsIdentity(nearest.path, repositoryIdentity))
  ) {
    throw outsideRepositoryError();
  }
  return nearest;
}

async function createMissingDirectories(nearest) {
  const created = [];
  let candidate = nearest.path;
  for (const component of nearest.missingComponents) {
    candidate = join(candidate, component);
    try {
      await mkdir(candidate, { mode: 0o700 });
      created.push(candidate);
    } catch (error) {
      if (error?.code !== 'EEXIST' || !(await stat(candidate)).isDirectory()) {
        throw error;
      }
    }
  }
  return created;
}

function secureWindowsPath(path, isDirectory) {
  const environment = {
    ...process.env,
    TAWREED_ACL_TARGET: path,
    TAWREED_ACL_DIRECTORY: String(isDirectory),
  };
  delete environment.PSModulePath;
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', windowsAclScript],
    { encoding: 'utf8', windowsHide: true, env: environment },
  );
  if (result.status !== 0) {
    throw new Error(`Unable to restrict or verify Windows ACLs: ${result.stderr.trim()}`);
  }
}

async function secureUnixPath(path, mode) {
  await chmod(path, mode);
  const metadata = await stat(path);
  if ((metadata.mode & 0o777) !== mode) {
    throw new Error('Unable to enforce owner-only permissions');
  }
  if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) {
    throw new Error('Owner-only path is not owned by the current user');
  }
}

async function securePath(path, mode, isDirectory) {
  if (process.platform === 'win32') {
    secureWindowsPath(path, isDirectory);
  } else {
    await secureUnixPath(path, mode);
  }
}

async function generateRuntimeKeypair(outputDirectory) {
  if (isUnsafeWindowsAlias(outputDirectory)) {
    throw new Error('Unsafe Windows UNC or device path');
  }
  const requestedOutput = resolve(outputDirectory);
  const canonicalRepository = await realpath(repositoryRoot);
  const repositoryIdentity = await stat(canonicalRepository, { bigint: true });
  const nearest = await assertOutsideRepository(
    requestedOutput,
    canonicalRepository,
    repositoryIdentity,
  );
  const publicPath = join(canonicalRepository, 'src-tauri', 'runtime-updater.pub');
  const createdDirectories = [];
  let privatePath;
  let privateHandle;
  let privateCreated = false;
  let publicHandle;
  let publicCreated = false;
  let completed = false;

  try {
    createdDirectories.push(...(await createMissingDirectories(nearest)));
    const canonicalOutput = await realpath(requestedOutput);
    if (
      pathIsInside(canonicalRepository, canonicalOutput) ||
      (await ancestorChainContainsIdentity(requestedOutput, repositoryIdentity))
    ) {
      throw outsideRepositoryError();
    }
    await securePath(canonicalOutput, 0o700, true);
    privatePath = join(canonicalOutput, 'runtime-private.pem');

    try {
      privateHandle = await open(privatePath, 'wx', 0o600);
    } catch (error) {
      if (error?.code === 'EEXIST') {
        throw new Error(`Private key already exists at ${privatePath}`);
      }
      throw error;
    }
    privateCreated = true;

    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    const publicJwk = publicKey.export({ format: 'jwk' });
    const rawPublic = Buffer.from(publicJwk.x, 'base64url');
    if (rawPublic.length !== 32) {
      throw new Error('Unexpected Ed25519 public key length');
    }

    await privateHandle.writeFile(privatePem);
    await privateHandle.sync();
    await privateHandle.close();
    privateHandle = undefined;
    await securePath(privatePath, 0o600, false);

    try {
      publicHandle = await open(publicPath, 'wx');
    } catch (error) {
      if (error?.code === 'EEXIST') {
        throw new Error(`Public key already exists at ${publicPath}`);
      }
      throw error;
    }
    publicCreated = true;
    await publicHandle.writeFile(`${rawPublic.toString('base64')}\n`, 'utf8');
    await publicHandle.sync();
    await publicHandle.close();
    publicHandle = undefined;

    completed = true;
    return {
      privatePath,
      publicFingerprint: createHash('sha256').update(rawPublic).digest('hex'),
    };
  } finally {
    if (privateHandle) {
      await privateHandle.close().catch(() => {});
    }
    if (publicHandle) {
      await publicHandle.close().catch(() => {});
    }
    if (publicCreated && !completed) {
      await rm(publicPath, { force: true }).catch(() => {});
    }
    if (privateCreated && !completed) {
      await rm(privatePath, { force: true }).catch(() => {});
    }
    if (!completed) {
      for (const directory of createdDirectories.reverse()) {
        await rmdir(directory).catch(() => {});
      }
    }
  }
}

async function main() {
  if (process.argv.length !== 3) {
    throw new Error(usage);
  }
  const result = await generateRuntimeKeypair(process.argv[2]);
  console.log(`Private key: ${result.privatePath}`);
  console.log(`Public key SHA-256: ${result.publicFingerprint}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
