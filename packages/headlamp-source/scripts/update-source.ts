const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  composePatchSeries,
  materializeHeadlampPatch,
} = require('./compose-patches.ts');

/** Purpose displayed by the script's help output. */
const SCRIPT_PURPOSE =
  'Materialize or update pinned Headlamp source, package metadata, and patch integrity.';
/** Usage displayed by the script's help output. */
const SCRIPT_USAGE = `Usage:
  update-source.ts --prepare [--root <path>] [--source <checkout>] [--help]
  update-source.ts --source <checkout> [--commit <sha>] [--base-tag <tag>] [--root <path>] [--help]

  --prepare          Materialize the configured source and aggregate patch.
  --source <path>    Clean Headlamp checkout used instead of fetching source.
  --commit <sha>     Full source commit used in update mode.
  --base-tag <tag>   Optional release tag used for package versioning.
  --root <path>      Consumer project root.
  --help             Show this help text.`;

const PACKAGE_NAME: string = '@headlamp-k8s/headlamp-source';
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const BASE_TAG_PATTERN = /^v(\d+\.\d+\.\d+)$/;
const SOURCE_MARKER = '.source-commit';
const REQUIRED_SOURCE_PATHS = [
  'package.json',
  'LICENSE',
  'README.md',
  'Dockerfile',
  'app',
  'backend',
  'frontend',
];

/** Headlamp repository and revision configuration stored by the consumer. */
interface HeadlampSourceConfig {
  /** Git repository from which Headlamp source is fetched. */
  repository: string;
  /** Human-readable source ref recorded in package metadata. */
  ref?: string;
  /** Full authoritative Headlamp source commit SHA. */
  commit: string;
  /** Source commit used before the most recent update. */
  previousCommit?: string;
  /** Optional release tag used as the package version baseline. */
  baseTag?: string;
}

/** Options for materializing configured Headlamp source. */
interface PrepareHeadlampSourceOptions {
  /** Consumer project root; defaults to `INIT_CWD` or the current directory. */
  rootDir?: string;
  /** Local Headlamp source package directory. */
  packageDir?: string;
  /** Existing clean Headlamp checkout used instead of fetching source. */
  sourceDir?: string;
}

/** Result of preparing configured Headlamp source. */
interface PrepareHeadlampSourceResult {
  /** Absolute local Headlamp source package directory. */
  packageDir: string;
  /** Whether source was newly materialized during this call. */
  prepared: boolean;
}

/** Options for updating the pinned Headlamp source revision. */
interface UpdateHeadlampSourceOptions extends PrepareHeadlampSourceOptions {
  /** Clean Headlamp checkout matching the requested commit. */
  sourceDir: string;
  /** Full source commit to adopt; defaults to the current configuration. */
  commit?: string;
  /** Optional release tag used as the package version baseline. */
  baseTag?: string;
}

/** Result of updating the pinned Headlamp source revision. */
interface UpdateHeadlampSourceResult {
  /** Absolute local Headlamp source package directory. */
  packageDir: string;
  /** Absolute generated aggregate patch path. */
  patchPath: string;
  /** Commit-qualified local source package version. */
  version: string;
}

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
 * Runs a command and throws when it fails.
 *
 * @param command - Executable to run.
 * @param args - Arguments passed to the executable.
 * @param cwd - Optional working directory.
 * @returns The command's standard output.
 */
function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed${cwd ? ` in ${cwd}` : ''}:\n${
        result.stderr || result.stdout
      }`
    );
  }
  return result.stdout;
}

/**
 * Calculates npm's SHA-512 integrity string for a file.
 *
 * @param file - File whose contents are hashed.
 * @returns A `sha512-` integrity string.
 */
function sha512(file) {
  return `sha512-${createHash('sha512')
    .update(fs.readFileSync(file))
    .digest('base64')}`;
}

/**
 * Derives a source-package version from a pinned commit and optional release tag.
 *
 * @param config - Commit and optional base tag used for versioning.
 * @returns The commit-qualified package version.
 */
function sourceVersion(config: Pick<HeadlampSourceConfig, 'baseTag' | 'commit'>): string {
  const commit = config.commit.toLowerCase();
  if (!COMMIT_PATTERN.test(commit)) {
    throw new Error(`Headlamp commit must be a full Git SHA: ${config.commit}`);
  }
  if (config.baseTag === undefined) {
    return `0.0.0-main.${commit.slice(0, 8)}`;
  }
  const tag = BASE_TAG_PATTERN.exec(config.baseTag);
  if (!tag) {
    throw new Error(`Headlamp base tag must look like v0.44.0: ${config.baseTag}`);
  }
  return `${tag[1]}-main.${commit.slice(0, 8)}`;
}

/**
 * Verifies that a clean Headlamp checkout matches the configured commit.
 *
 * @param sourceDir - Headlamp Git checkout to verify.
 * @param commit - Expected full commit SHA.
 * @returns Nothing.
 */
function verifySourceCheckout(sourceDir, commit) {
  const actualCommit = run('git', ['rev-parse', 'HEAD'], sourceDir).trim();
  if (actualCommit !== commit) {
    throw new Error(`Headlamp source checkout is at ${actualCommit}, which does not match ${commit}`);
  }
  const changes = run(
    'git',
    ['status', '--porcelain', '--untracked-files=no'],
    sourceDir
  ).trim();
  if (changes) {
    throw new Error('Headlamp source checkout has tracked changes');
  }
  for (const required of REQUIRED_SOURCE_PATHS) {
    if (!fs.existsSync(path.join(sourceDir, required))) {
      throw new Error(`Headlamp source checkout is missing ${required}`);
    }
  }
}

/**
 * Rejects tracked source paths that could escape the package directory.
 *
 * @param relativeFile - Git-tracked path relative to the source checkout.
 * @returns Nothing.
 */
function validateTrackedSourcePath(relativeFile) {
  const normalizedPath = relativeFile.replaceAll('\\', '/');
  if (
    path.posix.isAbsolute(normalizedPath) ||
    path.win32.isAbsolute(relativeFile) ||
    normalizedPath === '..' ||
    normalizedPath.startsWith('../')
  ) {
    throw new Error(`Unsafe Headlamp source path: ${relativeFile}`);
  }
}

/**
 * Removes Azure Artifacts mirror URLs that npm treats as disallowed remote packages.
 *
 * Package versions and integrity hashes remain authoritative, allowing npm to
 * resolve the same package through the consumer's configured registry.
 *
 * @param lockFile - npm lockfile copied into the source package.
 * @returns The number of mirror resolutions removed.
 */
function removeAzureArtifactsResolutions(lockFile): number {
  const lock = readJson(lockFile);
  let removed = 0;
  for (const entry of Object.values(lock.packages || {})) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const resolved = (entry as { resolved?: unknown }).resolved;
    if (typeof resolved !== 'string') {
      continue;
    }
    let hostname;
    try {
      hostname = new URL(resolved).hostname;
    } catch {
      continue;
    }
    if (
      hostname.endsWith('.pkgs.visualstudio.com') &&
      typeof (entry as { version?: unknown }).version === 'string' &&
      typeof (entry as { integrity?: unknown }).integrity === 'string'
    ) {
      delete (entry as { resolved?: string }).resolved;
      removed++;
    }
  }
  if (removed > 0) {
    writeJson(lockFile, lock);
  }
  return removed;
}

/**
 * Copies only Git-tracked files from a verified Headlamp checkout.
 *
 * @param sourceDir - Verified Headlamp Git checkout.
 * @param destination - Destination source directory.
 * @returns Nothing.
 */
function copyTrackedSource(sourceDir, destination) {
  const files = run('git', ['ls-files', '-z'], sourceDir)
    .split('\0')
    .filter(Boolean);
  for (const relativeFile of files) {
    validateTrackedSourcePath(relativeFile);
    const source = path.join(sourceDir, relativeFile);
    const target = path.join(destination, relativeFile);
    const stat = fs.lstatSync(source);
    if (stat.isDirectory()) {
      throw new Error(`Headlamp source contains an uninitialized submodule: ${relativeFile}`);
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`Headlamp source contains a tracked symbolic link: ${relativeFile}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    fs.chmodSync(target, stat.mode);
    if (path.basename(relativeFile) === 'package-lock.json') {
      removeAzureArtifactsResolutions(target);
    }
  }
}

/**
 * Atomically replaces the package's materialized Headlamp source tree.
 *
 * @param packageDir - Local Headlamp source package directory.
 * @param sourceDir - Verified Headlamp Git checkout.
 * @param commit - Full source commit SHA recorded in the marker.
 * @returns Nothing.
 */
function materializeHeadlampSource(packageDir, sourceDir, commit) {
  const resolvedSourceDir = fs.realpathSync(sourceDir);
  verifySourceCheckout(resolvedSourceDir, commit);
  const temporarySource = fs.mkdtempSync(path.join(packageDir, '.source-'));
  const temporaryMarker = `${temporarySource}.commit`;
  const source = path.join(packageDir, 'source');
  const marker = path.join(packageDir, SOURCE_MARKER);
  let sourceInstalled = false;
  try {
    copyTrackedSource(resolvedSourceDir, temporarySource);
    fs.writeFileSync(temporaryMarker, `${commit}\n`);
    fs.rmSync(source, { recursive: true, force: true });
    fs.renameSync(temporarySource, source);
    sourceInstalled = true;
    fs.rmSync(marker, { recursive: true, force: true });
    fs.renameSync(temporaryMarker, marker);
  } catch (error) {
    fs.rmSync(temporarySource, { recursive: true, force: true });
    fs.rmSync(temporaryMarker, { force: true });
    if (sourceInstalled) {
      fs.rmSync(source, { recursive: true, force: true });
    }
    throw error;
  }
}

/**
 * Checks whether the expected Headlamp commit is already materialized.
 *
 * @param packageDir - Local Headlamp source package directory.
 * @param commit - Expected full source commit SHA.
 * @returns Whether the source marker and required paths are current.
 */
function sourceIsMaterialized(packageDir, commit) {
  const marker = path.join(packageDir, SOURCE_MARKER);
  let materializedCommit;
  try {
    materializedCommit = fs.readFileSync(marker, 'utf8').trim();
  } catch {
    return false;
  }
  if (materializedCommit !== commit) {
    return false;
  }
  return REQUIRED_SOURCE_PATHS.every(required =>
    fs.existsSync(path.join(packageDir, 'source', required))
  );
}

/**
 * Fetches one Headlamp commit into a temporary detached checkout.
 *
 * @param repository - Headlamp Git repository URL.
 * @param commit - Full commit SHA to fetch.
 * @returns The temporary checkout directory.
 */
function fetchSourceCheckout(repository, commit) {
  const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'headlamp-checkout-'));
  try {
    run('git', ['init', '--quiet'], checkout);
    run(
      'git',
      ['fetch', '--quiet', '--no-tags', '--filter=blob:none', repository, commit],
      checkout
    );
    run('git', ['checkout', '--quiet', '--detach', 'FETCH_HEAD'], checkout);
    return checkout;
  } catch (error) {
    fs.rmSync(checkout, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Materializes configured Headlamp source and the aggregate npm patch.
 *
 * @param options - Optional consumer root, package, and source checkout overrides.
 * @returns The package directory and whether source was newly prepared.
 */
function prepareHeadlampSource(
  options: PrepareHeadlampSourceOptions = {}
): PrepareHeadlampSourceResult {
  const rootDir = path.resolve(options.rootDir || process.env.INIT_CWD || process.cwd());
  const packageDir = path.resolve(options.packageDir || path.join(__dirname, '..'));
  const config = readJson(path.join(rootDir, 'package.json')).headlampSource;
  if (!config) {
    throw new Error('package.json must declare headlampSource');
  }
  const packageManifest = readJson(path.join(packageDir, 'package.json'));
  const version = sourceVersion(config);
  if (
    packageManifest.version !== version ||
    packageManifest.repository?.url !== config.repository ||
    packageManifest.repository?.commit !== config.commit
  ) {
    throw new Error(
      'Headlamp source package metadata does not match package.json#headlampSource'
    );
  }
  if (sourceIsMaterialized(packageDir, config.commit)) {
    materializeHeadlampPatch(rootDir);
    console.log(`Headlamp source ${config.commit} is already materialized`);
    return { packageDir, prepared: false };
  }

  const checkout = options.sourceDir
    ? fs.realpathSync(options.sourceDir)
    : fetchSourceCheckout(config.repository, config.commit);
  try {
    materializeHeadlampSource(packageDir, checkout, config.commit);
  } finally {
    if (!options.sourceDir) {
      fs.rmSync(checkout, { recursive: true, force: true });
    }
  }
  materializeHeadlampPatch(rootDir);
  console.log(`Materialized Headlamp source ${config.commit}`);
  return { packageDir, prepared: true };
}

/**
 * Updates generated source-package metadata for a source pin.
 *
 * @param packageDir - Local Headlamp source package directory.
 * @param config - Source repository, ref, commit, and versioning configuration.
 * @param version - Derived package version.
 * @returns The updated package manifest.
 */
function updatePackageManifest(packageDir, config: HeadlampSourceConfig, version) {
  const manifestPath = path.join(packageDir, 'package.json');
  const manifest = readJson(manifestPath);
  manifest.version = version;
  manifest.repository.url = config.repository;
  manifest.repository.commit = config.commit;
  manifest.headlampSource = {
    ref: config.ref,
    ...(config.baseTag ? { baseTag: config.baseTag } : {}),
    ...(config.previousCommit ? { previousCommit: config.previousCommit } : {}),
    commit: config.commit,
  };
  manifest.scripts['build:container'] =
    `docker buildx build --pull --platform=local ` +
    `--build-arg HEADLAMP_SOURCE_COMMIT=${config.commit} ` +
    `--build-arg HEADLAMP_BUILD_MANIFEST ` +
    `-t ghcr.io/headlamp-k8s/headlamp:${version} -f source/Dockerfile source`;
  manifest.scripts['build:plugins-container'] =
    `docker buildx build --pull --platform=local ` +
    `-t ghcr.io/headlamp-k8s/plugins:${version} -f source/Dockerfile.plugins source`;
  writeJson(manifestPath, manifest);
  return manifest;
}

/**
 * Updates the Headlamp source pin, materialized source, package metadata, and patch integrity.
 *
 * @param options - Source checkout and optional root, package, commit, and tag overrides.
 * @returns Updated package directory, aggregate patch path, and package version.
 */
function updateHeadlampSource(
  options: UpdateHeadlampSourceOptions
): UpdateHeadlampSourceResult {
  const rootDir = path.resolve(options.rootDir || process.env.INIT_CWD || process.cwd());
  const packageDir = path.resolve(options.packageDir || path.join(__dirname, '..'));
  const projectPath = path.join(rootDir, 'package.json');
  const lockPath = path.join(rootDir, 'package-lock.json');
  const project = readJson(projectPath);
  const lock = readJson(lockPath);
  const currentConfig = project.headlampSource;
  if (!currentConfig) {
    throw new Error('package.json must declare headlampSource');
  }
  const nextCommit = options.commit?.toLowerCase();
  const config = {
    ...currentConfig,
    ...(options.baseTag ? { baseTag: options.baseTag } : {}),
    ...(nextCommit
      ? {
          ...(nextCommit !== currentConfig.commit
            ? { previousCommit: currentConfig.commit }
            : {}),
          commit: nextCommit,
        }
      : {}),
  } as HeadlampSourceConfig;
  const version = sourceVersion(config);
  const sourceDir = fs.realpathSync(options.sourceDir);
  verifySourceCheckout(sourceDir, config.commit);

  const patchEntries = Object.entries(project.patchedDependencies || {}).filter(([selector]) =>
    selector.startsWith(`${PACKAGE_NAME}@`)
  );
  if (patchEntries.length !== 1) {
    throw new Error(`Expected one ${PACKAGE_NAME} patch, found ${patchEntries.length}`);
  }
  const [oldSelector, oldPatchPath] = patchEntries[0];
  const newSelector = `${PACKAGE_NAME}@${version}`;
  const newPatchPath = `patches/headlamp-source@${version}.patch`;
  const absoluteOldPatch = path.join(rootDir, oldPatchPath);
  const absoluteNewPatch = path.join(rootDir, newPatchPath);

  materializeHeadlampSource(packageDir, sourceDir, config.commit);

  const packageManifest = updatePackageManifest(packageDir, config, version);
  fs.writeFileSync(absoluteNewPatch, composePatchSeries(rootDir, packageDir));
  project.headlampSource = config;
  project.devDependencies[PACKAGE_NAME] = version;
  delete project.patchedDependencies[oldSelector];
  project.patchedDependencies[newSelector] = newPatchPath;

  lock.packages[''].devDependencies[PACKAGE_NAME] = version;
  lock.packages[`node_modules/${PACKAGE_NAME}`] = {
    version,
    resolved: `file:${path.relative(rootDir, packageDir).split(path.sep).join('/')}`,
    dev: true,
    license: packageManifest.license,
    dependencies: packageManifest.dependencies,
    engines: packageManifest.engines,
    patched: {
      integrity: sha512(absoluteNewPatch),
      path: newPatchPath,
    },
  };
  if (oldPatchPath !== newPatchPath) {
    fs.rmSync(absoluteOldPatch, { force: true });
  }

  writeJson(projectPath, project);
  writeJson(lockPath, lock);
  console.log(`Prepared ${PACKAGE_NAME}@${version} from ${config.commit}`);
  console.log(`Run npm ci to apply and validate ${newPatchPath}`);

  return {
    packageDir,
    patchPath: absoluteNewPatch,
    version,
  };
}

/**
 * Reads a named option value from the process command line.
 *
 * @param name - Command-line option name.
 * @returns The following option value, or `undefined` when absent.
 */
function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (require.main === module) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`${SCRIPT_PURPOSE}\n\n${SCRIPT_USAGE}`);
  } else {
    const rootDir = argument('--root');
    if (process.argv.includes('--prepare')) {
      prepareHeadlampSource({
        rootDir,
        sourceDir: argument('--source'),
      });
    } else {
      const sourceDir = argument('--source');
      if (!sourceDir) {
        throw new Error(SCRIPT_USAGE);
      }
      updateHeadlampSource({
        rootDir,
        sourceDir,
        commit: argument('--commit'),
        baseTag: argument('--base-tag'),
      });
    }
  }
}

module.exports = {
  SCRIPT_PURPOSE,
  SCRIPT_USAGE,
  prepareHeadlampSource,
  removeAzureArtifactsResolutions,
  sourceVersion,
  updateHeadlampSource,
  validateTrackedSourcePath,
};
