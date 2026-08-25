#!/usr/bin/env node

import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
} from 'node:fs/promises';
import { userInfo } from 'node:os';
import {
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const usage = 'Usage: node scripts/generate-runtime-keypair.mjs';

const windowsHomeScript = String.raw`
$ErrorActionPreference = 'Stop'
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$keyPath = "SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$sid"
$key = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($keyPath)
if ($null -eq $key) { throw 'Current account profile is unavailable' }
try {
  $raw = [string]$key.GetValue(
    'ProfileImagePath',
    $null,
    [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames
  )
} finally {
  $key.Dispose()
}
if ([string]::IsNullOrWhiteSpace($raw)) { throw 'Current account profile is unavailable' }
if ($raw -match '^(?i)%SystemDrive%(.*)$') {
  $drive = [System.IO.Path]::GetPathRoot([System.Environment]::SystemDirectory).TrimEnd('\')
  $expanded = "$drive$($Matches[1])"
} elseif ($raw.Contains('%')) {
  throw 'Unsupported variable in current account profile'
} else {
  $expanded = $raw
}
[System.IO.Path]::GetFullPath($expanded)
`;

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

function powershell(command, environment = {}) {
  const childEnvironment = { ...process.env, ...environment };
  delete childEnvironment.PSModulePath;
  return spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', command],
    { encoding: 'utf8', windowsHide: true, env: childEnvironment },
  );
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function pathIsInside(parent, candidate) {
  const pathFromParent = relative(parent, candidate);
  return (
    pathFromParent === '' ||
    (!pathFromParent.startsWith(`..${sep}`) &&
      pathFromParent !== '..' &&
      !isAbsolute(pathFromParent))
  );
}

async function canonicalDirectory(path, label) {
  if (!path || !isAbsolute(path) || resolve(path) !== path) {
    throw new Error(`${label} must be an exact absolute path`);
  }
  if (
    process.platform === 'win32' &&
    (!/^[A-Za-z]:\\/.test(path) || path.includes('/') || parse(path).root.length !== 3)
  ) {
    throw new Error(`${label} must be a normal drive-letter path`);
  }
  const metadata = await lstat(path, { bigint: true });
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must identify a non-reparse directory`);
  }
  const canonical = await realpath(path);
  if (canonical !== path) {
    throw new Error(`${label} must not use an alias path`);
  }
  return canonical;
}

export async function resolveActualHome() {
  let reportedHome;
  if (process.platform === 'win32') {
    const result = powershell(windowsHomeScript);
    if (result.status !== 0) {
      throw new Error(`Unable to resolve current account home: ${result.stderr.trim()}`);
    }
    reportedHome = result.stdout.trim();
  } else {
    reportedHome = userInfo().homedir;
  }
  if (!reportedHome) {
    throw new Error('Unable to resolve current account home');
  }
  return canonicalDirectory(reportedHome, 'Current account home');
}

function secureWindowsPath(path, isDirectory) {
  const result = powershell(windowsAclScript, {
    TAWREED_ACL_TARGET: path,
    TAWREED_ACL_DIRECTORY: String(isDirectory),
  });
  if (result.status !== 0) {
    throw new Error(
      `Unable to restrict or verify Windows ACLs: ${result.stderr.trim()}`,
    );
  }
}

async function verifyUnixOwnerOnly(path, mode) {
  const metadata = await stat(path);
  if ((metadata.mode & 0o777) !== mode) {
    throw new Error('Unable to enforce owner-only permissions');
  }
  if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) {
    throw new Error('Owner-only path is not owned by the current user');
  }
}

async function assertPublicKeyAbsent(publicPath) {
  try {
    await lstat(publicPath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return;
    }
    throw error;
  }
  throw new Error(`Public key already exists at ${publicPath}`);
}

async function requireDirectoryIdentity(path, expectedIdentity) {
  const current = await lstat(path, { bigint: true });
  if (
    !current.isDirectory() ||
    current.isSymbolicLink() ||
    !sameIdentity(current, expectedIdentity)
  ) {
    throw new Error('Output directory identity changed or became a reparse point');
  }
}

async function requireOpenFileIdentity(path, handle, expectedIdentity) {
  const [handleIdentity, pathIdentity] = await Promise.all([
    handle.stat({ bigint: true }),
    lstat(path, { bigint: true }),
  ]);
  if (
    pathIdentity.isSymbolicLink() ||
    !sameIdentity(handleIdentity, expectedIdentity) ||
    !sameIdentity(pathIdentity, expectedIdentity)
  ) {
    throw new Error('Created file identity changed or became a reparse point');
  }
}

async function quarantineCreatedPath(path, expectedIdentity, isDirectory) {
  if (!expectedIdentity) {
    return;
  }
  const quarantine = `${path}.cleanup-${randomUUID()}`;
  try {
    await rename(path, quarantine);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return;
    }
    throw error;
  }

  let movedIdentity;
  try {
    movedIdentity = await lstat(quarantine, { bigint: true });
  } catch {
    return;
  }
  if (
    sameIdentity(movedIdentity, expectedIdentity) &&
    !movedIdentity.isSymbolicLink()
  ) {
    if (isDirectory) {
      try {
        await rmdir(quarantine);
        return;
      } catch (error) {
        if (error?.code !== 'ENOTEMPTY') {
          throw error;
        }
      }
    } else {
      await rm(quarantine, { force: true });
      return;
    }
  }
  await rename(quarantine, path).catch(() => {});
}

async function closeHandle(handle) {
  if (handle) {
    await handle.close().catch(() => {});
  }
}

export async function generate({
  resolveActualHome: homeResolver = resolveActualHome,
  hooks = {},
  repoRoot = repositoryRoot,
} = {}) {
  const [actualHome, canonicalRepoRoot] = await Promise.all([
    homeResolver().then((path) => canonicalDirectory(path, 'Current account home')),
    canonicalDirectory(await realpath(repoRoot), 'Repository root'),
  ]);
  const outputDirectory = join(actualHome, '.tawreed-signing');
  const publicPath = join(canonicalRepoRoot, 'src-tauri', 'runtime-updater.pub');

  await assertPublicKeyAbsent(publicPath);
  if (
    pathIsInside(canonicalRepoRoot, actualHome) ||
    pathIsInside(canonicalRepoRoot, outputDirectory)
  ) {
    throw new Error('Signing output must remain outside the repository');
  }

  let directoryIdentity;
  let privatePath;
  let privateHandle;
  let privateIdentity;
  let publicHandle;
  let publicIdentity;
  let completed = false;

  try {
    try {
      await mkdir(outputDirectory, { mode: 0o700 });
    } catch (error) {
      if (error?.code === 'EEXIST') {
        throw new Error(`Output directory must not already exist: ${outputDirectory}`);
      }
      throw error;
    }
    directoryIdentity = await lstat(outputDirectory, { bigint: true });
    await requireDirectoryIdentity(outputDirectory, directoryIdentity);
    await hooks.afterMkdir?.({ outputDirectory });
    await requireDirectoryIdentity(outputDirectory, directoryIdentity);

    if (process.platform === 'win32') {
      secureWindowsPath(outputDirectory, true);
    } else {
      await verifyUnixOwnerOnly(outputDirectory, 0o700);
    }
    await requireDirectoryIdentity(outputDirectory, directoryIdentity);
    await hooks.afterSecurityVerification?.({ outputDirectory });
    await requireDirectoryIdentity(outputDirectory, directoryIdentity);

    privatePath = join(outputDirectory, 'runtime-private.pem');
    privateHandle = await open(privatePath, 'wx', 0o600);
    privateIdentity = await privateHandle.stat({ bigint: true });
    await requireDirectoryIdentity(outputDirectory, directoryIdentity);
    await requireOpenFileIdentity(privatePath, privateHandle, privateIdentity);

    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    const publicJwk = publicKey.export({ format: 'jwk' });
    const rawPublic = Buffer.from(publicJwk.x, 'base64url');
    if (rawPublic.length !== 32) {
      throw new Error('Unexpected Ed25519 public key length');
    }

    await requireDirectoryIdentity(outputDirectory, directoryIdentity);
    await requireOpenFileIdentity(privatePath, privateHandle, privateIdentity);
    await privateHandle.writeFile(privatePem);
    await privateHandle.sync();
    if (process.platform === 'win32') {
      secureWindowsPath(privatePath, false);
    } else {
      await verifyUnixOwnerOnly(privatePath, 0o600);
    }
    await requireOpenFileIdentity(privatePath, privateHandle, privateIdentity);
    await requireDirectoryIdentity(outputDirectory, directoryIdentity);

    try {
      publicHandle = await open(publicPath, 'wx');
    } catch (error) {
      if (error?.code === 'EEXIST') {
        throw new Error(`Public key already exists at ${publicPath}`);
      }
      throw error;
    }
    publicIdentity = await publicHandle.stat({ bigint: true });
    await requireOpenFileIdentity(publicPath, publicHandle, publicIdentity);
    await publicHandle.writeFile(`${rawPublic.toString('base64')}\n`, 'utf8');
    await publicHandle.sync();
    await requireOpenFileIdentity(publicPath, publicHandle, publicIdentity);

    completed = true;
    await closeHandle(publicHandle);
    publicHandle = undefined;
    await closeHandle(privateHandle);
    privateHandle = undefined;
    return {
      privatePath,
      publicFingerprint: createHash('sha256').update(rawPublic).digest('hex'),
    };
  } finally {
    if (!completed) {
      if (publicHandle) {
        await requireOpenFileIdentity(publicPath, publicHandle, publicIdentity)
          .then(() => quarantineCreatedPath(publicPath, publicIdentity, false))
          .catch(() => {});
      }
      await closeHandle(publicHandle);

      if (privateHandle) {
        await requireOpenFileIdentity(privatePath, privateHandle, privateIdentity)
          .then(() => quarantineCreatedPath(privatePath, privateIdentity, false))
          .catch(() => {});
      }
      await closeHandle(privateHandle);

      await quarantineCreatedPath(
        outputDirectory,
        directoryIdentity,
        true,
      ).catch(() => {});
    }
  }
}

async function main() {
  if (process.argv.length !== 2) {
    throw new Error(usage);
  }
  const result = await generate();
  console.log(`Private key: ${result.privatePath}`);
  console.log(`Public key SHA-256: ${result.publicFingerprint}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
