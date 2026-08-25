#!/usr/bin/env node

import { generateKeyPairSync, createHash } from 'node:crypto';
import {
  chmod,
  mkdir,
  open,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
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
  const requestedOutput = resolve(outputDirectory);
  const canonicalRepository = await realpath(repositoryRoot);

  if (pathIsInside(canonicalRepository, requestedOutput)) {
    throw new Error('Output directory must be outside the repository');
  }

  await mkdir(requestedOutput, { recursive: true, mode: 0o700 });
  const canonicalOutput = await realpath(requestedOutput);
  if (pathIsInside(canonicalRepository, canonicalOutput)) {
    throw new Error('Output directory must be outside the repository');
  }
  await securePath(canonicalOutput, 0o700, true);

  const privatePath = join(canonicalOutput, 'runtime-private.pem');
  const publicPath = join(canonicalRepository, 'src-tauri', 'runtime-updater.pub');
  let privateHandle;
  let privateCreated = false;
  let completed = false;

  try {
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

    await writeFile(publicPath, `${rawPublic.toString('base64')}\n`, {
      encoding: 'utf8',
    });

    completed = true;
    return {
      privatePath,
      publicFingerprint: createHash('sha256').update(rawPublic).digest('hex'),
    };
  } finally {
    if (privateHandle) {
      await privateHandle.close().catch(() => {});
    }
    if (privateCreated && !completed) {
      await rm(privatePath, { force: true }).catch(() => {});
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
