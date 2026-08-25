import assert from 'node:assert/strict';
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, parse, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const sourceScript = fileURLToPath(
  new URL('./generate-runtime-keypair.mjs', import.meta.url),
);

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'tawreed-keygen-test-'));
  const repository = join(root, 'repository');
  const script = join(repository, 'scripts', 'generate-runtime-keypair.mjs');
  await mkdir(dirname(script), { recursive: true });
  await mkdir(join(repository, 'src-tauri'), { recursive: true });
  await copyFile(sourceScript, script);
  return {
    root,
    repository,
    script,
    outputDirectory: join(root, 'signing'),
  };
}

function runScript(script, args) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    windowsHide: true,
  });
}

async function withFixture(callback) {
  const fixture = await makeFixture();
  try {
    await callback(fixture);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
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
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      encoding: 'utf8',
      windowsHide: true,
      env: Object.fromEntries(
        Object.entries({ ...process.env, TAWREED_ACL_TARGET: path }).filter(
          ([key]) => key.toUpperCase() !== 'PSMODULEPATH',
        ),
      ),
    },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim());
}

async function pathSecuritySnapshot(path) {
  if (process.platform !== 'win32') {
    const metadata = await stat(path);
    return `${metadata.mode & 0o777}:${metadata.uid}:${metadata.gid}`;
  }

  const script = String.raw`
$ErrorActionPreference = 'Stop'
(Get-Acl -LiteralPath $env:TAWREED_ACL_TARGET).Sddl
`;
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      encoding: 'utf8',
      windowsHide: true,
      env: Object.fromEntries(
        Object.entries({ ...process.env, TAWREED_ACL_TARGET: path }).filter(
          ([key]) => key.toUpperCase() !== 'PSMODULEPATH',
        ),
      ),
    },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('requires exactly one output directory argument', async () => {
  await withFixture(async ({ script }) => {
    for (const args of [[], ['one', 'two']]) {
      const result = runScript(script, args);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Usage: node scripts\/generate-runtime-keypair\.mjs <output-directory>/);
    }
  });
});

test('refuses output directories inside the repository', async () => {
  await withFixture(async ({ repository, script }) => {
    const outputDirectory = join(repository, 'private-keys');
    const result = runScript(script, [outputDirectory]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /outside the repository/);
    await assert.rejects(access(join(outputDirectory, 'runtime-private.pem')));
  });
});

test('refuses a junction or symlink into the repository before any mutation', async () => {
  await withFixture(async ({ root, repository, script }) => {
    const alias = join(root, 'repository-alias');
    await symlink(
      repository,
      alias,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const outputDirectory = join(alias, 'private-keys');
    const repositoryDestination = join(repository, 'private-keys');
    const securityBefore = await pathSecuritySnapshot(repository);

    const result = runScript(script, [outputDirectory]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /outside the repository/);
    await assert.rejects(access(repositoryDestination));
    await assert.rejects(access(join(repositoryDestination, 'runtime-private.pem')));
    assert.equal(await pathSecuritySnapshot(repository), securityBefore);
  });
});

test(
  'refuses Windows UNC and device aliases before any mutation',
  { skip: process.platform !== 'win32' },
  async () => {
    await withFixture(async ({ repository, script }) => {
      const { root: driveRoot } = parse(repository);
      const driveLetter = driveRoot[0];
      const pathBelowDrive = repository.slice(driveRoot.length).split(sep).join('\\');
      const aliases = [
        `\\\\localhost\\${driveLetter}$\\${pathBelowDrive}\\unc-private-keys`,
        `\\\\?\\${repository}\\device-private-keys`,
      ];
      const destinations = [
        join(repository, 'unc-private-keys'),
        join(repository, 'device-private-keys'),
      ];
      const securityBefore = await pathSecuritySnapshot(repository);

      for (let index = 0; index < aliases.length; index += 1) {
        const result = runScript(script, [aliases[index]]);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Unsafe Windows UNC or device path/);
        await assert.rejects(access(destinations[index]));
        await assert.rejects(access(join(destinations[index], 'runtime-private.pem')));
        assert.equal(await pathSecuritySnapshot(repository), securityBefore);
      }
    });
  },
);

test('writes a protected PKCS8 private key outside the repository and only the raw public key inside it', async () => {
  await withFixture(async ({ repository, script, outputDirectory }) => {
    const result = runScript(script, [outputDirectory]);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /BEGIN PRIVATE KEY|PRIVATE KEY-----/);
    assert.doesNotMatch(result.stderr, /BEGIN PRIVATE KEY|PRIVATE KEY-----/);

    const privatePath = join(outputDirectory, 'runtime-private.pem');
    const publicPath = join(repository, 'src-tauri', 'runtime-updater.pub');
    const privatePem = await readFile(privatePath);
    const publicBase64 = (await readFile(publicPath, 'utf8')).trim();
    const rawPublic = Buffer.from(publicBase64, 'base64');

    assert.equal(rawPublic.length, 32);
    assert.equal(`${publicBase64}\n`, await readFile(publicPath, 'utf8'));
    const derivedPublic = createPublicKey(createPrivateKey(privatePem)).export({
      format: 'jwk',
    });
    assert.deepEqual(rawPublic, Buffer.from(derivedPublic.x, 'base64url'));

    const fingerprint = createHash('sha256').update(rawPublic).digest('hex');
    assert.match(result.stdout, new RegExp(fingerprint));

    if (process.platform === 'win32') {
      const acl = await windowsAclSummary(privatePath);
      assert.equal(acl.protected, true);
      assert.equal(acl.owner, acl.current);
      assert.equal(acl.ruleCount, 1);
      assert.equal(acl.allCurrent, true);
      assert.equal(acl.allAllow, true);
      assert.equal(acl.allFullControl, true);
    } else {
      const { mode } = await import('node:fs/promises').then(({ stat }) =>
        stat(privatePath),
      );
      assert.equal(mode & 0o777, 0o600);
    }
  });
});

test('refuses to overwrite an existing private key', async () => {
  await withFixture(async ({ script, outputDirectory }) => {
    const first = runScript(script, [outputDirectory]);
    assert.equal(first.status, 0, first.stderr);
    const privatePath = join(outputDirectory, 'runtime-private.pem');
    const originalPrivate = await readFile(privatePath);

    const second = runScript(script, [outputDirectory]);
    assert.notEqual(second.status, 0);
    assert.match(second.stderr, /already exists/);
    assert.deepEqual(await readFile(privatePath), originalPrivate);
  });
});

test('preserves an existing public trust root and removes only newly created output', async () => {
  await withFixture(async ({ repository, script, outputDirectory }) => {
    const publicPath = join(repository, 'src-tauri', 'runtime-updater.pub');
    const existingPublic = 'existing-public-trust-root\n';
    await writeFile(publicPath, existingPublic, 'utf8');

    const result = runScript(script, [outputDirectory]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Public key already exists/);
    assert.equal(await readFile(publicPath, 'utf8'), existingPublic);
    await assert.rejects(access(join(outputDirectory, 'runtime-private.pem')));
    await assert.rejects(access(outputDirectory));
  });
});
