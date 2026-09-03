/**
 * Parses and composes the ordered Headlamp patch series, then verifies or updates the aggregate
 * npm patch and its lockfile integrity.
 */
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PACKAGE_NAME: string = '@headlamp-k8s/headlamp-source';
const SERIES_ENTRY_PATTERN =
  /^(\d{4}) (source|package) ((\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.patch)$/;

/**
 * Reads and parses a JSON file.
 *
 * @param file - JSON file to read.
 * @returns The parsed JSON value.
 */
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Writes a value as formatted JSON with a trailing newline.
 *
 * @param file - Destination JSON file.
 * @param value - Value to serialize.
 * @returns Nothing.
 */
function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Calculates npm's SHA-512 integrity string for a value.
 *
 * @param value - Bytes or text to hash.
 * @returns A `sha512-` integrity string.
 */
function sha512(value) {
  return `sha512-${createHash('sha512').update(value).digest('base64')}`;
}

/**
 * Parses and validates an ordered numbered patch series.
 *
 * @param value - Newline-delimited patch series contents.
 * @returns Ordered patch file and scope records.
 */
function parsePatchSeries(value) {
  const lines = value.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) {
    throw new Error('Headlamp patch series is empty');
  }
  const files = new Set();
  let previousNumber = 0;
  return lines.map(line => {
    const match = SERIES_ENTRY_PATTERN.exec(line);
    const number = Number(match?.[1]);
    if (
      !match ||
      match[1] !== match[4] ||
      number <= previousNumber
    ) {
      throw new Error(`Invalid Headlamp patch series entry: ${line}`);
    }
    previousNumber = number;
    const [, , scope, file] = match;
    if (files.has(file)) {
      throw new Error(`Duplicate Headlamp patch series entry: ${file}`);
    }
    files.add(file);
    return { file, scope };
  });
}

/**
 * Runs a Git command and throws when it fails.
 *
 * @param args - Arguments passed to Git.
 * @param options - Working directory, encoding, and environment overrides.
 * @returns The command's standard output.
 */
function runGit(args, options: any = {}) {
  const result = spawnSync('git', args, {
    cwd: options.cwd,
    encoding: options.encoding,
    env: { ...process.env, ...options.env },
    maxBuffer: 100 * 1024 * 1024,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

/**
 * Applies the numbered series and creates npm's aggregate package patch.
 *
 * @param rootDir - Consumer project root.
 * @param packageDir - Local Headlamp source package directory.
 * @returns The complete aggregate patch contents.
 */
function composePatchSeries(
  rootDir = process.env.INIT_CWD || process.cwd(),
  packageDir = path.join(rootDir, 'packages', 'headlamp-source')
) {
  const patchDir = path.join(rootDir, 'patches');
  const entries = parsePatchSeries(fs.readFileSync(path.join(patchDir, 'series'), 'utf8'));
  if (!fs.existsSync(path.join(packageDir, 'source'))) {
    throw new Error('Headlamp source is not materialized; run source:prepare first');
  }

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'headlamp-patches-'));
  const gitConfig = path.join(temporaryDirectory, 'gitconfig');
  const gitDir = path.join(temporaryDirectory, 'repository.git');
  try {
    fs.writeFileSync(gitConfig, '');
    runGit(['init', '--bare', '--quiet', gitDir]);
    const repository = {
      cwd: packageDir,
      env: {
        GIT_CONFIG_GLOBAL: gitConfig,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_DIR: gitDir,
        GIT_WORK_TREE: packageDir,
      },
    };
    runGit(['add', '--all', '--', '.'], repository);
    const baseTree = runGit(['write-tree'], { ...repository, encoding: 'utf8' }).trim();
    for (const entry of entries) {
      const args = ['apply', '--cached', '--whitespace=nowarn'];
      if (entry.scope === 'source') {
        args.push('--directory=source');
      }
      args.push(path.join(patchDir, entry.file));
      runGit(args, repository);
    }
    return runGit(
      [
        '-c',
        'diff.algorithm=myers',
        'diff',
        '--cached',
        '--binary',
        '--full-index',
        '--no-color',
        '--no-ext-diff',
        '--no-renames',
        '--src-prefix=a/',
        '--dst-prefix=b/',
        baseTree,
        '--',
      ],
      repository
    );
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

/**
 * Resolves the single configured Headlamp patched dependency.
 *
 * @param rootDir - Consumer project root.
 * @returns The npm patch selector and relative patch path.
 */
function configuredPatch(rootDir) {
  const manifest = readJson(path.join(rootDir, 'package.json'));
  const entries = Object.entries(manifest.patchedDependencies || {}).filter(([selector]) =>
    selector.startsWith(`${PACKAGE_NAME}@`)
  );
  if (entries.length !== 1) {
    throw new Error(`Expected one ${PACKAGE_NAME} npm patch, found ${entries.length}`);
  }
  const [selector, patchPath] = entries[0];
  if (
    typeof patchPath !== 'string' ||
    path.dirname(patchPath) !== 'patches' ||
    !path.basename(patchPath).startsWith('headlamp-source@')
  ) {
    throw new Error(`Invalid ${PACKAGE_NAME} npm patch path: ${patchPath}`);
  }
  return { patchPath, selector };
}

/**
 * Builds the aggregate patch state used for generation or verification.
 *
 * @param rootDir - Consumer project root.
 * @returns Aggregate contents, lock metadata, paths, and calculated integrity.
 */
function patchState(rootDir) {
  const { patchPath } = configuredPatch(rootDir);
  const aggregate = composePatchSeries(rootDir);
  const absolutePatch = path.join(rootDir, patchPath);
  const lockPath = path.join(rootDir, 'package-lock.json');
  const lock = readJson(lockPath);
  const lockEntry = lock.packages[`node_modules/${PACKAGE_NAME}`];
  const integrity = sha512(aggregate);

  if (!lockEntry?.patched) {
    throw new Error(`${PACKAGE_NAME} is not patched in package-lock.json`);
  }
  return { absolutePatch, aggregate, integrity, lock, lockEntry, lockPath, patchPath };
}

/**
 * Writes the aggregate patch after verifying its recorded lockfile integrity.
 *
 * @param rootDir - Consumer project root.
 * @returns Nothing.
 */
function materializeHeadlampPatch(rootDir = process.env.INIT_CWD || process.cwd()) {
  const { absolutePatch, aggregate, integrity, lockEntry, patchPath } = patchState(rootDir);
  if (lockEntry.patched.path !== patchPath || lockEntry.patched.integrity !== integrity) {
    throw new Error('Run npm run headlamp:patches to update the patch lock integrity');
  }
  fs.writeFileSync(absolutePatch, aggregate);
  console.log(`Generated ${patchPath}`);
}

/**
 * Generates or verifies the aggregate patch and lockfile integrity.
 *
 * @param rootDir - Consumer project root.
 * @param check - Whether to verify existing output instead of updating it.
 * @returns Nothing.
 */
function updateHeadlampPatch(rootDir = process.env.INIT_CWD || process.cwd(), check = false) {
  const { absolutePatch, aggregate, integrity, lock, lockEntry, lockPath, patchPath } =
    patchState(rootDir);
  if (check) {
    if (!fs.existsSync(absolutePatch) || !fs.readFileSync(absolutePatch).equals(aggregate)) {
      throw new Error(`Run npm run headlamp:patches to update ${patchPath}`);
    }
    if (
      lockEntry.patched.path !== patchPath ||
      lockEntry.patched.integrity !== integrity
    ) {
      throw new Error('Run npm run headlamp:patches to update the patch lock integrity');
    }
    return;
  }

  fs.writeFileSync(absolutePatch, aggregate);
  lockEntry.patched = { integrity, path: patchPath };
  writeJson(lockPath, lock);
  console.log(`Composed ${patchPath}`);
}

module.exports = {
  composePatchSeries,
  materializeHeadlampPatch,
  parsePatchSeries,
  updateHeadlampPatch,
};
