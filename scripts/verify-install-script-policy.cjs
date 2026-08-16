const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
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

function validatePolicy(packageJson, packageLock) {
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

function verifyProjectNpmConfiguration() {
  const options = { cwd: root, encoding: 'utf8', timeout: 30_000 };
  const result = process.env.npm_execpath
    ? spawnSync(process.execPath, [process.env.npm_execpath, 'config', 'get', 'strict-allow-scripts', '--location=project'], options)
    : spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['config', 'get', 'strict-allow-scripts', '--location=project'], options);

  if (result.status !== 0 || result.stdout.trim() !== 'true') {
    fail('Project npm configuration must enable strict-allow-scripts=true.', result);
  }
}

const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const packageLock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));

validatePolicy(packageJson, packageLock);
verifyProjectNpmConfiguration();

const negativeFixture = structuredClone(packageJson);
negativeFixture.allowScripts = { ...negativeFixture.allowScripts };
delete negativeFixture.allowScripts[Object.keys(negativeFixture.allowScripts)[0]];
let rejected = false;
try {
  validatePolicy(negativeFixture, packageLock);
} catch {
  rejected = true;
}
if (!rejected) {
  fail('The policy validator accepted an intentionally incomplete approval set.');
}

console.log('Verified exact npm install-script approvals and strict project enforcement.');
