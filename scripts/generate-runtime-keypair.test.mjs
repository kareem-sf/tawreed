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
  rm,
  stat,
  symlink,
  utimes,
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
    environment:
      process.platform === 'win32' ? { USERPROFILE: home } : { HOME: home },
  };
}

function runScript(script, args, environment) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, ...environment },
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

test('requires exactly one output directory argument', async () => {
  await withFixture(async ({ script, environment }) => {
    for (const args of [[], ['one', 'two']]) {
      const result = runScript(script, args, environment);
      assert.notEqual(result.status, 0);
      assert.match(
        result.stderr,
        /Usage: node scripts\/generate-runtime-keypair\.mjs <output-directory>/,
      );
    }
  });
});

test('creates a protected keypair only at the exact user-home child', async () => {
  await withFixture(
    async ({ repository, script, outputDirectory, environment }) => {
      const result = runScript(script, [outputDirectory], environment);
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
        const directoryAcl = await windowsAclSummary(outputDirectory);
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
        assert.equal((await stat(outputDirectory)).mode & 0o777, 0o700);
        assert.equal((await stat(privatePath)).mode & 0o777, 0o600);
      }
    },
  );
});

test('an existing exact output directory fails without content or security mutation', async () => {
  await withFixture(
    async ({ repository, script, outputDirectory, environment }) => {
      await mkdir(outputDirectory);
      const sentinel = join(outputDirectory, 'sentinel.txt');
      await writeFile(sentinel, 'preserve me\n', 'utf8');
      const securityBefore = await pathSecuritySnapshot(outputDirectory);

      const result = runScript(script, [outputDirectory], environment);

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Output directory must not already exist/);
      assert.equal(await readFile(sentinel, 'utf8'), 'preserve me\n');
      assert.deepEqual(await readdir(outputDirectory), ['sentinel.txt']);
      assert.equal(await pathSecuritySnapshot(outputDirectory), securityBefore);
      await assert.rejects(
        access(join(repository, 'src-tauri', 'runtime-updater.pub')),
      );
    },
  );
});

test('an existing public key aborts before the absent output directory is created', async () => {
  await withFixture(
    async ({ repository, home, script, outputDirectory, environment }) => {
      const publicPath = join(repository, 'src-tauri', 'runtime-updater.pub');
      const existingPublic = 'existing-public-trust-root\n';
      await writeFile(publicPath, existingPublic, 'utf8');
      await utimes(home, new Date(1_000), new Date(1_000));
      const homeBefore = await directoryMutationSnapshot(home);

      const result = runScript(script, [outputDirectory], environment);

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Public key already exists/);
      assert.equal(await readFile(publicPath, 'utf8'), existingPublic);
      await assert.rejects(access(outputDirectory));
      assert.deepEqual(await directoryMutationSnapshot(home), homeBefore);
    },
  );
});

test('an existing symlink or junction at the exact path fails without target mutation', async () => {
  await withFixture(
    async ({ root, repository, script, outputDirectory, environment }) => {
      const target = join(root, 'alias-target');
      await mkdir(target);
      const sentinel = join(target, 'sentinel.txt');
      await writeFile(sentinel, 'preserve target\n', 'utf8');
      await symlink(
        target,
        outputDirectory,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      const securityBefore = await pathSecuritySnapshot(target);

      const result = runScript(script, [outputDirectory], environment);

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Output directory must not already exist/);
      assert.equal((await lstat(outputDirectory)).isSymbolicLink(), true);
      assert.equal(await readFile(sentinel, 'utf8'), 'preserve target\n');
      assert.deepEqual(await readdir(target), ['sentinel.txt']);
      assert.equal(await pathSecuritySnapshot(target), securityBefore);
      await assert.rejects(
        access(join(repository, 'src-tauri', 'runtime-updater.pub')),
      );
    },
  );
});

test('alternate, partial, nested, basename, and parent paths are rejected before mutation', async (context) => {
  const cases = [
    ['alternate trailing separator', ({ outputDirectory }) => `${outputDirectory}${sep}`],
    [
      'alternate dot segment',
      ({ home }) => `${home}${sep}segment${sep}..${sep}.tawreed-signing`,
    ],
    ['different basename', ({ home }) => join(home, '.tawreed-signing-other')],
    ['different parent', ({ root }) => join(root, '.tawreed-signing')],
    ['nested suffix', ({ outputDirectory }) => join(outputDirectory, 'nested')],
  ];

  for (const [name, buildCandidate] of cases) {
    await context.test(name, async () => {
      await withFixture(async (fixture) => {
        const result = runScript(
          fixture.script,
          [buildCandidate(fixture)],
          fixture.environment,
        );
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /exact output directory/);
        await assert.rejects(access(fixture.outputDirectory));
        await assert.rejects(
          access(join(fixture.repository, 'src-tauri', 'runtime-updater.pub')),
        );
      });
    });
  }
});

test(
  'Windows UNC and device aliases are rejected before mutation',
  { skip: process.platform !== 'win32' },
  async () => {
    await withFixture(async (fixture) => {
      const { root: driveRoot } = parse(fixture.outputDirectory);
      const driveLetter = driveRoot[0];
      const pathBelowDrive = fixture.outputDirectory
        .slice(driveRoot.length)
        .split(sep)
        .join('\\');
      const aliases = [
        `\\\\localhost\\${driveLetter}$\\${pathBelowDrive}`,
        `\\\\?\\${fixture.outputDirectory}`,
      ];
      const homeBefore = await directoryMutationSnapshot(fixture.home);

      for (const alias of aliases) {
        const result = runScript(
          fixture.script,
          [alias],
          fixture.environment,
        );
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /exact output directory/);
        await assert.rejects(access(fixture.outputDirectory));
        assert.deepEqual(await directoryMutationSnapshot(fixture.home), homeBefore);
      }
    });
  },
);

test(
  'a mapped-drive alias of the exact home child is rejected before mutation',
  { skip: process.platform !== 'win32' },
  async () => {
    await withFixture(async (fixture) => {
      let driveLetter;
      for (let code = 'Z'.charCodeAt(0); code >= 'P'.charCodeAt(0); code -= 1) {
        try {
          await access(`${String.fromCharCode(code)}:\\`);
        } catch {
          driveLetter = String.fromCharCode(code);
          break;
        }
      }
      assert.ok(driveLetter, 'no unused drive letter available for subst test');
      const mount = spawnSync(
        'subst.exe',
        [`${driveLetter}:`, fixture.home],
        { encoding: 'utf8', windowsHide: true },
      );
      assert.equal(mount.status, 0, mount.stderr);
      try {
        const result = runScript(
          fixture.script,
          [`${driveLetter}:\\.tawreed-signing`],
          fixture.environment,
        );
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /exact output directory/);
        await assert.rejects(access(fixture.outputDirectory));
        await assert.rejects(
          access(join(fixture.repository, 'src-tauri', 'runtime-updater.pub')),
        );
      } finally {
        const unmount = spawnSync(
          'subst.exe',
          [`${driveLetter}:`, '/D'],
          { encoding: 'utf8', windowsHide: true },
        );
        assert.equal(unmount.status, 0, unmount.stderr);
      }
    });
  },
);
