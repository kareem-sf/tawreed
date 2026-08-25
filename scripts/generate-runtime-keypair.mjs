#!/usr/bin/env node

import { createHash, generateKeyPairSync } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  realpath,
  rm,
  rmdir,
  stat,
} from 'node:fs/promises';
import {
  dirname,
  isAbsolute,
  join,
  parse,
  resolve,
} from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicPath = join(repositoryRoot, 'src-tauri', 'runtime-updater.pub');
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

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function removeIfStillCreated(path, expectedIdentity, isDirectory) {
  if (!expectedIdentity) {
    return;
  }
  try {
    const currentIdentity = await lstat(path, { bigint: true });
    if (!sameIdentity(currentIdentity, expectedIdentity)) {
      return;
    }
    if (isDirectory) {
      await rmdir(path);
    } else {
      await rm(path, { force: true });
    }
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.code !== 'ENOTEMPTY') {
      throw error;
    }
  }
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

async function configuredUserHome() {
  const variable = process.platform === 'win32' ? 'USERPROFILE' : 'HOME';
  const home = process.env[variable];
  if (!home || !isAbsolute(home) || resolve(home) !== home) {
    throw new Error(`${variable} must be an exact absolute user-home path`);
  }
  if (
    process.platform === 'win32' &&
    (!/^[A-Za-z]:\\/.test(home) || home.includes('/') || parse(home).root.length !== 3)
  ) {
    throw new Error('USERPROFILE must be a normal drive-letter path');
  }

  const homeLinkMetadata = await lstat(home);
  if (!homeLinkMetadata.isDirectory() || homeLinkMetadata.isSymbolicLink()) {
    throw new Error(`${variable} must identify a real directory`);
  }
  if ((await realpath(home)) !== home) {
    throw new Error(`${variable} must not use an alias path`);
  }
  return home;
}

async function assertPublicKeyAbsent() {
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

async function generateRuntimeKeypair(outputDirectory) {
  const home = await configuredUserHome();
  const requiredOutput = join(home, '.tawreed-signing');
  if (outputDirectory !== requiredOutput) {
    throw new Error(`Use the exact output directory ${requiredOutput}`);
  }

  await assertPublicKeyAbsent();

  let directoryCreated = false;
  let directoryIdentity;
  let privatePath;
  let privateHandle;
  let privateCreated = false;
  let privateIdentity;
  let publicHandle;
  let publicCreated = false;
  let publicIdentity;
  let completed = false;

  try {
    try {
      await mkdir(requiredOutput, { mode: 0o700 });
    } catch (error) {
      if (error?.code === 'EEXIST') {
        throw new Error(`Output directory must not already exist: ${requiredOutput}`);
      }
      throw error;
    }
    directoryCreated = true;
    directoryIdentity = await lstat(requiredOutput, { bigint: true });

    if (process.platform === 'win32') {
      secureWindowsPath(requiredOutput, true);
    } else {
      await verifyUnixOwnerOnly(requiredOutput, 0o700);
    }
    const securedDirectoryIdentity = await lstat(requiredOutput, { bigint: true });
    if (!sameIdentity(directoryIdentity, securedDirectoryIdentity)) {
      throw new Error('Output directory identity changed during security setup');
    }

    privatePath = join(requiredOutput, 'runtime-private.pem');
    privateHandle = await open(privatePath, 'wx', 0o600);
    privateCreated = true;
    privateIdentity = await privateHandle.stat({ bigint: true });

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
    if (process.platform === 'win32') {
      secureWindowsPath(privatePath, false);
    } else {
      await verifyUnixOwnerOnly(privatePath, 0o600);
    }

    try {
      publicHandle = await open(publicPath, 'wx');
    } catch (error) {
      if (error?.code === 'EEXIST') {
        throw new Error(`Public key already exists at ${publicPath}`);
      }
      throw error;
    }
    publicCreated = true;
    publicIdentity = await publicHandle.stat({ bigint: true });
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
      await removeIfStillCreated(publicPath, publicIdentity, false).catch(() => {});
    }
    if (privateCreated && !completed) {
      await removeIfStillCreated(privatePath, privateIdentity, false).catch(() => {});
    }
    if (directoryCreated && !completed) {
      await removeIfStillCreated(requiredOutput, directoryIdentity, true).catch(() => {});
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
