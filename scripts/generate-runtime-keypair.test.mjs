import assert from 'node:assert/strict';
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import {
  access,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import * as keypair from './generate-runtime-keypair.mjs';

const sourceScript = fileURLToPath(
  new URL('./generate-runtime-keypair.mjs', import.meta.url),
);

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'tawreed-keygen-test-'));
  const repository = join(root, 'repository');
  const home = join(root, 'home');
  const script = join(repository, 'scripts', 'generate-runtime-keypair.mjs');
  await mkdir(dirname(script), { recursive: true });
  await mkdir(join(repository, 'src-tauri'), { recursive: true });
  await mkdir(home);
  await copyFile(sourceScript, script);
  return {
    root,
    repository,
    home,
    script,
    outputDirectory: join(home, '.tawreed-signing'),
    publicPath: join(repository, 'src-tauri', 'runtime-updater.pub'),
  };
}

async function withFixture(callback) {
  const fixture = await makeFixture();
  try {
    await callback(fixture);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

function runScript(script, args, environment = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, ...environment },
  });
}

async function generateIn(fixture, overrides = {}) {
  return keypair.generate({
    repoRoot: fixture.repository,
    resolveActualHome: async () => fixture.home,
    hooks: {},
    ...overrides,
  });
}

function windowsPowerShell(script, target) {
  return spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      encoding: 'utf8',
      windowsHide: true,
      env: Object.fromEntries(
        Object.entries({ ...process.env, TAWREED_ACL_TARGET: target }).filter(
          ([key]) => key.toUpperCase() !== 'PSMODULEPATH',
        ),
      ),
    },
  );
}

async function windowsAclSummary(path) {
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$target = $env:TAWREED_ACL_TARGET
$current = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = Get-Acl -LiteralPath $target
$rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
[pscustomobject]@{
  protected = $acl.AreAccessRulesProtected
  owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
  current = $current.Value
  ruleCount = $rules.Count
  allCurrent = @($rules | Where-Object { $_.IdentityReference.Value -ne $current.Value }).Count -eq 0
  allAllow = @($rules | Where-Object { $_.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow }).Count -eq 0
  allFullControl = @($rules | Where-Object { ($_.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -ne [System.Security.AccessControl.FileSystemRights]::FullControl }).Count -eq 0
} | ConvertTo-Json -Compress
`;
  const result = windowsPowerShell(script, path);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim());
}

async function pathSecuritySnapshot(path) {
  if (process.platform !== 'win32') {
    const metadata = await stat(path);
    return `${metadata.mode & 0o777}:${metadata.uid}:${metadata.gid}`;
  }
  const result = windowsPowerShell(
    String.raw`$ErrorActionPreference = 'Stop'; (Get-Acl -LiteralPath $env:TAWREED_ACL_TARGET).Sddl`,
    path,
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function directoryMutationSnapshot(path) {
  const metadata = await stat(path, { bigint: true });
  return {
    mtimeNs: metadata.mtimeNs.toString(),
    entries: (await readdir(path)).sort(),
    security: await pathSecuritySnapshot(path),
  };
}

test('black-box CLI accepts zero arguments and rejects every supplied argument', async () => {
  await withFixture(async ({ script, home }) => {
    const result = runScript(script, ['unexpected'], {
      HOME: home,
      USERPROFILE: home,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Usage: node scripts\/generate-runtime-keypair\.mjs/);
  });
});

test('black-box CLI ignores spoofed HOME and USERPROFILE', async () => {
  await withFixture(async ({ script, home, publicPath, outputDirectory }) => {
    await writeFile(publicPath, 'existing-public-trust-root\n', 'utf8');
    const result = runScript(script, [], {
      HOME: home,
      USERPROFILE: home,
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Public key already exists/);
    await assert.rejects(access(outputDirectory));
  });
});

test('OS account-home resolver ignores HOME and USERPROFILE', async () => {
  const spoof = join(tmpdir(), 'spoofed-tawreed-home');
  const previousHome = process.env.HOME;
  const previousProfile = process.env.USERPROFILE;
  process.env.HOME = spoof;
  process.env.USERPROFILE = spoof;
  try {
    const actualHome = await keypair.resolveActualHome();
    assert.notEqual(actualHome, spoof);
    assert.equal(await realpath(actualHome), actualHome);
    assert.equal((await lstat(actualHome)).isDirectory(), true);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousProfile;
  }
});

test('injected core creates a protected keypair in a disposable actual home', async () => {
  await withFixture(async (fixture) => {
    const result = await generateIn(fixture);
    const privatePath = join(fixture.outputDirectory, 'runtime-private.pem');
    const privatePem = await readFile(privatePath);
    const publicBase64 = (await readFile(fixture.publicPath, 'utf8')).trim();
    const rawPublic = Buffer.from(publicBase64, 'base64');

    assert.equal(result.privatePath, privatePath);
    assert.equal(rawPublic.length, 32);
    assert.equal(`${publicBase64}\n`, await readFile(fixture.publicPath, 'utf8'));
    const derivedPublic = createPublicKey(createPrivateKey(privatePem)).export({
      format: 'jwk',
    });
    assert.deepEqual(rawPublic, Buffer.from(derivedPublic.x, 'base64url'));
    assert.equal(
      result.publicFingerprint,
      createHash('sha256').update(rawPublic).digest('hex'),
    );

    if (process.platform === 'win32') {
      const directoryAcl = await windowsAclSummary(fixture.outputDirectory);
      const privateAcl = await windowsAclSummary(privatePath);
      for (const acl of [directoryAcl, privateAcl]) {
        assert.equal(acl.owner, acl.current);
        assert.equal(acl.ruleCount, 1);
        assert.equal(acl.allCurrent, true);
        assert.equal(acl.allAllow, true);
        assert.equal(acl.allFullControl, true);
      }
      assert.equal(directoryAcl.protected, true);
    } else {
      assert.equal((await stat(fixture.outputDirectory)).mode & 0o777, 0o700);
      assert.equal((await stat(privatePath)).mode & 0o777, 0o600);
    }
  });
});

test('injected actual home inside the repository is rejected before mutation', async () => {
  await withFixture(async (fixture) => {
    const before = await directoryMutationSnapshot(fixture.repository);
    await assert.rejects(
      keypair.generate({
        repoRoot: fixture.repository,
        resolveActualHome: async () => fixture.repository,
        hooks: {},
      }),
      /outside the repository/,
    );
    await assert.rejects(
      access(join(fixture.repository, '.tawreed-signing')),
    );
    assert.deepEqual(await directoryMutationSnapshot(fixture.repository), before);
  });
});

test('existing output and public paths fail before mutation', async (context) => {
  await context.test('existing output', async () => {
    await withFixture(async (fixture) => {
      await mkdir(fixture.outputDirectory);
      const sentinel = join(fixture.outputDirectory, 'sentinel.txt');
      await writeFile(sentinel, 'preserve me\n', 'utf8');
      const before = await directoryMutationSnapshot(fixture.outputDirectory);

      await assert.rejects(generateIn(fixture), /must not already exist/);

      assert.equal(await readFile(sentinel, 'utf8'), 'preserve me\n');
      assert.deepEqual(
        await directoryMutationSnapshot(fixture.outputDirectory),
        before,
      );
      await assert.rejects(access(fixture.publicPath));
    });
  });

  await context.test('existing public key', async () => {
    await withFixture(async (fixture) => {
      await writeFile(fixture.publicPath, 'existing-public-trust-root\n', 'utf8');
      await utimes(fixture.home, new Date(1_000), new Date(1_000));
      const before = await directoryMutationSnapshot(fixture.home);

      await assert.rejects(generateIn(fixture), /Public key already exists/);

      assert.equal(
        await readFile(fixture.publicPath, 'utf8'),
        'existing-public-trust-root\n',
      );
      await assert.rejects(access(fixture.outputDirectory));
      assert.deepEqual(await directoryMutationSnapshot(fixture.home), before);
    });
  });
});

test('existing exact-path symlink or junction fails without target mutation', async () => {
  await withFixture(async (fixture) => {
    const target = join(fixture.root, 'alias-target');
    await mkdir(target);
    const sentinel = join(target, 'sentinel.txt');
    await writeFile(sentinel, 'preserve target\n', 'utf8');
    await symlink(
      target,
      fixture.outputDirectory,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const before = await directoryMutationSnapshot(target);

    await assert.rejects(generateIn(fixture), /must not already exist/);

    assert.equal((await lstat(fixture.outputDirectory)).isSymbolicLink(), true);
    assert.equal(await readFile(sentinel, 'utf8'), 'preserve target\n');
    assert.deepEqual(await directoryMutationSnapshot(target), before);
    await assert.rejects(access(fixture.publicPath));
  });
});

for (const hookName of ['afterMkdir', 'afterSecurityVerification']) {
  test(`${hookName} directory swap aborts without touching replacement target`, async () => {
    await withFixture(async (fixture) => {
      const target = join(fixture.root, `${hookName}-target`);
      const displaced = join(fixture.root, `${hookName}-created-directory`);
      await mkdir(target);
      const sentinel = join(target, 'sentinel.txt');
      await writeFile(sentinel, 'preserve replacement\n', 'utf8');
      const targetBefore = await directoryMutationSnapshot(target);

      await assert.rejects(
        generateIn(fixture, {
          hooks: {
            [hookName]: async ({ outputDirectory }) => {
              await rename(outputDirectory, displaced);
              await symlink(
                target,
                outputDirectory,
                process.platform === 'win32' ? 'junction' : 'dir',
              );
            },
          },
        }),
        /identity changed|reparse point/,
      );

      assert.equal((await lstat(fixture.outputDirectory)).isSymbolicLink(), true);
      assert.equal((await lstat(displaced)).isDirectory(), true);
      assert.equal(await readFile(sentinel, 'utf8'), 'preserve replacement\n');
      assert.deepEqual(await directoryMutationSnapshot(target), targetBefore);
      await assert.rejects(
        access(join(target, 'runtime-private.pem')),
      );
      await assert.rejects(access(fixture.publicPath));
    });
  });
}
