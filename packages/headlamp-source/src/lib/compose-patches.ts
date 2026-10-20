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
const PATCH_RECEIPT = '.headlamp-patch-integrity';
const SERIES_ENTRY_PATTERN =
  /^(\d{4}[a-z]?) (source|package) ((\d{4}[a-z]?)-[a-z0-9]+(?:-[a-z0-9]+)*\.patch)$/;

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
 * Calculates the Git blob ID for a regular file.
 *
 * @param file - File to hash, or an absent path for the zero ID.
 * @returns The SHA-1 Git blob ID.
 */
function gitBlobId(file) {
  if (!fs.existsSync(file)) {
    return '0'.repeat(40);
  }
  const contents = fs.readFileSync(file);
  return createHash('sha1')
    .update(`blob ${contents.length}\0`)
    .update(contents)
    .digest('hex');
}

/**
 * Identifies whether every file in a full-index patch is before or after the patch.
 *
 * @param packageDir - Installed package directory containing the patched paths.
 * @param aggregate - Full-index Git patch contents.
 * @returns `applied` or `unapplied` when file states agree, otherwise `stale`.
 */
function patchApplicationState(packageDir, aggregate) {
  const entries = [];
  let relativeFile;
  for (const line of aggregate.toString('utf8').split('\n')) {
    const diff = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (diff) {
      if (diff[1] !== diff[2] || path.isAbsolute(diff[2]) || diff[2].startsWith('../')) {
        throw new Error(`Unsupported aggregate patch path: ${line}`);
      }
      relativeFile = diff[2];
      continue;
    }
    const index = /^index ([0-9a-f]{40})\.\.([0-9a-f]{40})(?: \d+)?$/.exec(line);
    if (index && relativeFile) {
      entries.push({ relativeFile, oldId: index[1], newId: index[2] });
      relativeFile = undefined;
    }
  }
  if (entries.length === 0) {
    throw new Error('Aggregate patch has no full-index entries');
  }
  let oldFiles = 0;
  let newFiles = 0;
  let staleFiles = 0;
  for (const entry of entries) {
    const currentId = gitBlobId(path.join(packageDir, entry.relativeFile));
    if (currentId === entry.oldId) {
      oldFiles++;
    } else if (currentId === entry.newId) {
      newFiles++;
    } else {
      staleFiles++;
    }
  }
  if (staleFiles || (oldFiles && newFiles)) return 'stale';
  return newFiles ? 'applied' : 'unapplied';
}

/**
 * Replaces a generated installed package with a freshly patched source copy.
 *
 * The replacement is verified before the old package is moved. Dependencies at
 * the package root are retained; the normal install lifecycle reinstalls source
 * dependencies after replacing build-modified source and obsolete patch files.
 *
 * @param rootDir - Consumer root containing the maintained source package.
 * @param packageDir - Installed package directory to replace.
 * @param aggregate - Verified current full-index patch.
 * @returns Nothing.
 */
function refreshInstalledPackage(rootDir, packageDir, aggregate) {
  const sourcePackage = path.resolve(rootDir, 'packages', 'headlamp-source');
  if (readJson(path.join(rootDir, 'package.json')).headlampSource) {
    require('./update-source.ts').prepareHeadlampSource({ rootDir, packageDir: sourcePackage });
  }
  const temporaryDirectory = fs.mkdtempSync(path.join(path.dirname(packageDir), '.headlamp-install-'));
  const replacement = path.join(temporaryDirectory, 'package');
  const backup = path.join(temporaryDirectory, 'previous');
  try {
    fs.cpSync(sourcePackage, replacement, {
      recursive: true,
      filter: source => path.basename(source) !== 'node_modules',
    });
    if (patchApplicationState(replacement, aggregate) !== 'unapplied') {
      throw new Error('Maintained Headlamp source does not match the current patch base');
    }
    applyHeadlampPatch(rootDir, replacement);
    const dependencies = path.join(packageDir, 'node_modules');
    if (fs.existsSync(dependencies)) {
      fs.cpSync(dependencies, path.join(replacement, 'node_modules'), { recursive: true });
    }
    fs.renameSync(packageDir, backup);
    try {
      fs.renameSync(replacement, packageDir);
    } catch (error) {
      fs.renameSync(backup, packageDir);
      throw error;
    }
    fs.rmSync(backup, { recursive: true, force: true, maxRetries: 3 });
  } finally {
    if (!fs.existsSync(backup)) {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true, maxRetries: 3 });
    }
  }
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
  let previousLabel = '';
  return lines.map(line => {
    const match = SERIES_ENTRY_PATTERN.exec(line);
    if (
      !match ||
      match[1] !== match[4] ||
      match[1] <= previousLabel
    ) {
      throw new Error(`Invalid Headlamp patch series entry: ${line}`);
    }
    previousLabel = match[1];
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
 * Resolves the configured Headlamp aggregate patch.
 *
 * @param rootDir - Consumer project root.
 * @returns The npm patch selector and relative patch path.
 */
function configuredPatch(rootDir) {
  const manifest = readJson(path.join(rootDir, 'package.json'));
  const { integrity, path: patchPath } = manifest.headlampPatch || {};
  if (
    typeof patchPath !== 'string' ||
    path.dirname(patchPath) !== 'patches' ||
    !path.basename(patchPath).startsWith('headlamp-source@')
  ) {
    throw new Error(`Invalid ${PACKAGE_NAME} npm patch path: ${patchPath}`);
  }
  if (typeof integrity !== 'string' || !integrity.startsWith('sha512-')) {
    throw new Error(`Invalid ${PACKAGE_NAME} patch integrity`);
  }
  return { integrity, patchPath };
}

/**
 * Builds the aggregate patch state used for generation or verification.
 *
 * @param rootDir - Consumer project root.
 * @param packageDir - Optional source package location outside the consumer tree.
 * @returns Aggregate contents, lock metadata, paths, and calculated integrity.
 */
function patchState(rootDir, packageDir?: string) {
  const configured = configuredPatch(rootDir);
  const { patchPath } = configured;
  const aggregate = composePatchSeries(rootDir, packageDir);
  const absolutePatch = path.join(rootDir, patchPath);
  const integrity = sha512(aggregate);

  if (configured.integrity !== integrity) {
    throw new Error('Run npm run headlamp:patches to update the patch integrity');
  }
  return { absolutePatch, aggregate, integrity, patchPath };
}

/**
 * Writes the aggregate patch after verifying its recorded lockfile integrity.
 *
 * @param rootDir - Consumer project root.
 * @param packageDir - Optional source package location outside the consumer tree.
 * @returns Nothing.
 */
function materializeHeadlampPatch(
  rootDir = process.env.INIT_CWD || process.cwd(),
  packageDir?: string
) {
  const { absolutePatch, aggregate, patchPath } = patchState(rootDir, packageDir);
  fs.writeFileSync(absolutePatch, aggregate);
  console.log(`Generated ${patchPath}`);
}

/**
 * Applies the verified aggregate patch when npm has not already applied it.
 *
 * @param rootDir - Consumer project root.
 * @param packageDir - Installed Headlamp source package directory.
 * @returns Whether this call applied the patch.
 */
function applyHeadlampPatch(
  rootDir = process.env.INIT_CWD || process.cwd(),
  packageDir = path.join(rootDir, 'node_modules', '@headlamp-k8s', 'headlamp-source')
) {
  const { absolutePatch, aggregate, patchPath } = patchState(rootDir);
  if (!fs.readFileSync(absolutePatch).equals(Buffer.from(aggregate))) {
    throw new Error(`Checked-in patch does not match the authenticated aggregate: ${patchPath}`);
  }
  const resolvedPackageDir = path.resolve(rootDir, packageDir);
  const sourcePackage = fs.realpathSync(path.resolve(rootDir, 'packages', 'headlamp-source'));
  const installedPackage = fs.realpathSync(resolvedPackageDir);
  const relativePaths = [
    path.relative(installedPackage, sourcePackage),
    path.relative(sourcePackage, installedPackage),
  ];
  if (
    relativePaths.some(relative =>
      !relative || (
        !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)
      )
    ) || fs.lstatSync(resolvedPackageDir).isSymbolicLink()
  ) {
    throw new Error('Headlamp installation must be a separate copied source package');
  }
  const applicationState = patchApplicationState(resolvedPackageDir, aggregate);
  const receiptPath = path.join(resolvedPackageDir, PATCH_RECEIPT);
  const integrity = sha512(aggregate);
  const receipt = fs.existsSync(receiptPath)
    ? fs.readFileSync(receiptPath, 'utf8').trim()
    : undefined;
  if (applicationState === 'applied' && receipt === integrity) {
    console.log(`${patchPath} is already applied`);
    return false;
  }
  if (
    applicationState === 'stale' || applicationState === 'applied' ||
    (receipt && receipt !== integrity)
  ) {
    refreshInstalledPackage(rootDir, resolvedPackageDir, aggregate);
    if (patchApplicationState(resolvedPackageDir, aggregate) !== 'applied') {
      throw new Error(`Refreshed package does not match ${patchPath}`);
    }
    console.log(`Refreshed build-modified or outdated ${PACKAGE_NAME}`);
    return true;
  }
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'headlamp-apply-'));
  try {
    const gitDirectory = path.join(temporaryDirectory, 'repository.git');
    const gitConfig = path.join(temporaryDirectory, 'gitconfig');
    fs.writeFileSync(gitConfig, '');
    runGit(['init', '--bare', '--quiet', gitDirectory]);
    const verifiedPatch = path.join(temporaryDirectory, 'verified.patch');
    fs.writeFileSync(verifiedPatch, aggregate);
    runGit(['apply', '--whitespace=nowarn', verifiedPatch], {
      cwd: resolvedPackageDir,
      env: {
        GIT_CONFIG_GLOBAL: gitConfig,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_DIR: gitDirectory,
        GIT_INDEX_FILE: path.join(temporaryDirectory, 'index'),
        GIT_WORK_TREE: resolvedPackageDir,
      },
    });
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
  if (patchApplicationState(resolvedPackageDir, aggregate) !== 'applied') {
    throw new Error(`Failed to apply ${patchPath} to ${resolvedPackageDir}`);
  }
  fs.writeFileSync(receiptPath, `${integrity}\n`);
  console.log(`Applied ${patchPath}`);
  return true;
}

/**
 * Generates or verifies the aggregate patch and lockfile integrity.
 *
 * @param rootDir - Consumer project root.
 * @param check - Whether to verify existing output instead of updating it.
 * @returns Nothing.
 */
function updateHeadlampPatch(rootDir = process.env.INIT_CWD || process.cwd(), check = false) {
  const configured = configuredPatch(rootDir);
  const aggregate = composePatchSeries(rootDir);
  const absolutePatch = path.join(rootDir, configured.patchPath);
  const integrity = sha512(aggregate);
  if (check) {
    if (!fs.existsSync(absolutePatch) || !fs.readFileSync(absolutePatch).equals(aggregate)) {
      throw new Error(`Run npm run headlamp:patches to update ${configured.patchPath}`);
    }
    if (configured.integrity !== integrity) {
      throw new Error('Run npm run headlamp:patches to update the patch integrity');
    }
    return;
  }

  fs.writeFileSync(absolutePatch, aggregate);
  const manifestPath = path.join(rootDir, 'package.json');
  const manifest = readJson(manifestPath);
  manifest.headlampPatch = { path: configured.patchPath, integrity };
  writeJson(manifestPath, manifest);
  console.log(`Composed ${configured.patchPath}`);
}

module.exports = {
  applyHeadlampPatch,
  composePatchSeries,
  materializeHeadlampPatch,
  parsePatchSeries,
  updateHeadlampPatch,
};
