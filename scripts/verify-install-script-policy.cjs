const { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const root = resolve(__dirname, '..');

function fail(message, result) {
  const details = result
    ? `\nstdout:\n${result.stdout || '(empty)'}\nstderr:\n${result.stderr || '(empty)'}`
    : '';
  throw new Error(`${message}${details}`);
}

function packageNameFromLockPath(lockPath) {
  return lockPath.split('node_modules/').at(-1);
}

function verifyPinnedPolicy() {
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const packageLock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const approvals = packageJson.allowScripts ?? {};
  const approvedIdentities = new Set(Object.keys(approvals));

  if (approvedIdentities.size === 0) {
    fail('package.json must contain at least one reviewed install-script approval.');
  }

  for (const [identity, allowed] of Object.entries(approvals)) {
    if (allowed !== true) {
      fail(`Install-script policy entry ${identity} must be explicitly true.`);
    }

    const separator = identity.lastIndexOf('@');
    if (separator <= 0 || separator === identity.length - 1) {
      fail(`Install-script approval ${identity} must pin an exact package version.`);
    }

    const name = identity.slice(0, separator);
    const version = identity.slice(separator + 1);
    const locked = packageLock.packages?.[`node_modules/${name}`];
    if (!locked || locked.version !== version || locked.hasInstallScript !== true) {
      fail(`Install-script approval ${identity} does not match a scripted package in package-lock.json.`);
    }
  }

  const scriptedIdentities = new Set(
    Object.entries(packageLock.packages ?? {})
      .filter(([lockPath, metadata]) => lockPath && metadata?.hasInstallScript === true)
      .map(([lockPath, metadata]) => `${packageNameFromLockPath(lockPath)}@${metadata.version}`),
  );

  const missing = [...scriptedIdentities].filter((identity) => !approvedIdentities.has(identity));
  const stale = [...approvedIdentities].filter((identity) => !scriptedIdentities.has(identity));
  if (missing.length || stale.length) {
    fail(
      `Install-script policy does not match package-lock.json. Missing: ${missing.join(', ') || 'none'}. Stale: ${stale.join(', ') || 'none'}.`,
    );
  }
}

function runNpm(args, cwd, extraEnv = {}) {
  const options = {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
    timeout: 120_000,
  };
  if (process.env.npm_execpath) {
    return spawnSync(process.execPath, [process.env.npm_execpath, ...args], options);
  }
  return spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, options);
}

function verifyFailClosedBehavior() {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'tawreed-install-policy-'));
  const dependencyRoot = join(fixtureRoot, 'dependency');
  const marker = join(fixtureRoot, 'install-script-ran');

  try {
    mkdirSync(dependencyRoot);
    writeFileSync(
      join(dependencyRoot, 'package.json'),
      `${JSON.stringify({
        name: 'unreviewed-install-script',
        version: '1.0.0',
        scripts: { postinstall: 'node postinstall.cjs' },
      }, null, 2)}\n`,
    );
    writeFileSync(
      join(dependencyRoot, 'postinstall.cjs'),
      "require('node:fs').writeFileSync(process.env.TAWREED_POLICY_MARKER, 'executed');\n",
    );

    const fixturePackage = {
      name: 'tawreed-install-policy-fixture',
      version: '1.0.0',
      private: true,
      dependencies: { 'unreviewed-install-script': 'file:./dependency' },
    };
    writeFileSync(join(fixtureRoot, 'package.json'), `${JSON.stringify(fixturePackage, null, 2)}\n`);
    writeFileSync(join(fixtureRoot, '.npmrc'), 'strict-allow-scripts=true\n');

    const lock = runNpm(
      ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'],
      fixtureRoot,
    );
    if (lock.status !== 0) {
      fail('Could not create the isolated install-script policy fixture.', lock);
    }

    const denied = runNpm(
      ['ci', '--no-audit', '--no-fund'],
      fixtureRoot,
      { TAWREED_POLICY_MARKER: marker },
    );
    const deniedOutput = `${denied.stdout ?? ''}\n${denied.stderr ?? ''}`;
    if (denied.status === 0 || !/EALLOWSCRIPTS|allowScripts|allow-scripts/i.test(deniedOutput)) {
      fail('An unreviewed install script was not rejected by strict policy.', denied);
    }
    if (existsSync(marker)) {
      fail('The rejected fixture install script executed unexpectedly.');
    }

    fixturePackage.allowScripts = { 'unreviewed-install-script@1.0.0': true };
    writeFileSync(join(fixtureRoot, 'package.json'), `${JSON.stringify(fixturePackage, null, 2)}\n`);

    const approved = runNpm(
      ['ci', '--no-audit', '--no-fund'],
      fixtureRoot,
      { TAWREED_POLICY_MARKER: marker },
    );
    if (approved.status !== 0 || !existsSync(marker)) {
      fail('An exact reviewed install-script approval did not execute as expected.', approved);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

verifyPinnedPolicy();
verifyFailClosedBehavior();
console.log('Verified pinned npm install-script policy and fail-closed enforcement.');
