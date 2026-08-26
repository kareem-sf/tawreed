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

function scriptedIdentitiesFromLock(packageLock) {
  return new Set(
    Object.entries(packageLock.packages ?? {})
      .filter(([lockPath, metadata]) => lockPath && metadata?.hasInstallScript === true)
      .map(([lockPath, metadata]) => {
        const name = packageNameFromLockPath(lockPath);
        if (!name || typeof metadata.version !== 'string' || !metadata.version) {
          fail(`Scripted lockfile entry ${lockPath} is missing a package name or exact version.`);
        }
        return `${name}@${metadata.version}`;
      }),
  );
}

function validatePolicy(packageJson, packageLock, label = 'package.json') {
  const approvals = packageJson.allowScripts ?? {};
  const approvedIdentities = new Set(Object.keys(approvals));
  const scriptedIdentities = scriptedIdentitiesFromLock(packageLock);

  if (approvedIdentities.size === 0 && scriptedIdentities.size > 0) {
    fail(`${label} has scripted dependencies but no reviewed install-script approvals.`);
  }

  for (const [identity, allowed] of Object.entries(approvals)) {
    if (allowed !== true) {
      fail(`Install-script policy entry ${identity} must be explicitly true.`);
    }

    const separator = identity.lastIndexOf('@');
    if (separator <= 0 || separator === identity.length - 1) {
      fail(`Install-script approval ${identity} must pin an exact package version.`);
    }
  }

  const missing = [...scriptedIdentities].filter((identity) => !approvedIdentities.has(identity));
  const stale = [...approvedIdentities].filter((identity) => !scriptedIdentities.has(identity));
  if (missing.length || stale.length) {
    fail(
      `Install-script policy does not match package-lock.json. Missing: ${missing.join(', ') || 'none'}. Stale: ${stale.join(', ') || 'none'}.`,
    );
  }
}

function expectPolicyRejection(packageJson, packageLock, message) {
  try {
    validatePolicy(packageJson, packageLock);
  } catch {
    return;
  }
  fail(message);
}

function runNpmConfig(arguments_, cwd) {
  const options = { cwd, encoding: 'utf8', timeout: 30_000 };
  const result = process.env.npm_execpath
    ? spawnSync(process.execPath, [process.env.npm_execpath, ...arguments_], options)
    : spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', arguments_, options);
  return result;
}

function requireStrictAllowScripts(result, label) {
  if (result.status !== 0 || result.stdout.trim() !== 'true') {
    fail(`${label} npm configuration must enable strict-allow-scripts=true.`, result);
  }
}

function verifyProjectNpmConfiguration() {
  const arguments_ = ['config', 'get', 'strict-allow-scripts', '--location=project'];
  requireStrictAllowScripts(runNpmConfig(arguments_, root), 'Root');
  requireStrictAllowScripts(
    runNpmConfig(arguments_, resolve(root, 'agent-kernel')),
    'Agent',
  );
  requireStrictAllowScripts(
    runNpmConfig(['--prefix', 'agent-kernel', ...arguments_], root),
    'Prefixed agent',
  );
}

function readPackagePair(directory) {
  const label = directory === '.' ? 'package.json' : `${directory}/package.json`;
  return {
    label,
    packageJson: JSON.parse(readFileSync(resolve(root, directory, 'package.json'), 'utf8')),
    packageLock: JSON.parse(readFileSync(resolve(root, directory, 'package-lock.json'), 'utf8')),
  };
}

const packagePairs = ['.', 'agent-kernel'].map(readPackagePair);
for (const { label, packageJson, packageLock } of packagePairs) {
  validatePolicy(packageJson, packageLock, label);
}
verifyProjectNpmConfiguration();

const [{ packageJson, packageLock }] = packagePairs;
const incompletePolicy = structuredClone(packageJson);
incompletePolicy.allowScripts = { ...incompletePolicy.allowScripts };
delete incompletePolicy.allowScripts[Object.keys(incompletePolicy.allowScripts)[0]];
expectPolicyRejection(
  incompletePolicy,
  packageLock,
  'The policy validator accepted an intentionally incomplete approval set.',
);

expectPolicyRejection(
  { allowScripts: { esbuild: true } },
  packageLock,
  'The policy validator accepted a non-versioned package approval.',
);

validatePolicy(
  {
    allowScripts: {
      'nested-script@1.2.3': true,
      '@scope/scoped-script@4.5.6': true,
    },
  },
  {
    packages: {
      'node_modules/parent/node_modules/nested-script': {
        version: '1.2.3',
        hasInstallScript: true,
      },
      'node_modules/parent/node_modules/@scope/scoped-script': {
        version: '4.5.6',
        hasInstallScript: true,
      },
    },
  },
);

validatePolicy({ allowScripts: {} }, { packages: {} }, 'empty/package.json');
expectPolicyRejection(
  { allowScripts: {} },
  {
    packages: {
      'node_modules/unreviewed-script': {
        version: '1.0.0',
        hasInstallScript: true,
      },
    },
  },
  'The policy validator accepted an empty approval set for a scripted dependency graph.',
);

console.log('Verified exact npm install-script approvals for root and agent dependency graphs and strict project enforcement.');
