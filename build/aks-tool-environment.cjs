const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function verifiedAksToolPath(tool, resourcesDirectory, platform) {
  const entry = tool?.platforms?.[platform];
  if (entry === undefined) throw new Error(`AKS tool unavailable for ${platform}: ${tool?.id}`);
  if (
    typeof entry.path !== 'string' ||
    !entry.path ||
    path.posix.isAbsolute(entry.path) ||
    path.win32.isAbsolute(entry.path) ||
    typeof entry.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(entry.sha256)
  ) {
    throw new Error(`Invalid AKS tool: ${tool?.id}`);
  }
  const root = fs.realpathSync(resourcesDirectory);
  const candidate = path.resolve(root, entry.path);
  const relative = path.relative(root, candidate);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`AKS tool escapes resources: ${tool.id}`);
  }
  const canonical = fs.realpathSync(candidate);
  const canonicalRelative = path.relative(root, canonical);
  if (
    canonicalRelative === '..' ||
    canonicalRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(canonicalRelative) ||
    !fs.statSync(canonical).isFile()
  ) {
    throw new Error(`AKS tool escapes resources or is not a file: ${tool.id}`);
  }
  const digest = crypto.createHash('sha256').update(fs.readFileSync(canonical)).digest('hex');
  if (digest !== entry.sha256.toLowerCase())
    throw new Error(`AKS tool integrity mismatch: ${tool.id}`);
  return canonical;
}

function withAksToolPaths(environment, manifest, resourcesDirectory, platform = process.platform) {
  const tools = manifest['external-tools'];
  if (!Array.isArray(tools)) throw new Error('AKS external-tools must be an array');
  const directories = new Set();
  for (const tool of tools) {
    if (tool?.platforms?.[platform] === undefined) continue;
    const executable = verifiedAksToolPath(tool, resourcesDirectory, platform);
    directories.add(path.dirname(executable));
  }
  if (directories.size === 0) return { ...environment };
  const pathKeys = Object.keys(environment).filter(key =>
    platform === 'win32' ? key.toUpperCase() === 'PATH' : key === 'PATH'
  );
  const pathKey = pathKeys[0] ?? 'PATH';
  const result = { ...environment };
  for (const key of pathKeys) delete result[key];
  const inherited = pathKeys.map(key => environment[key]).filter(Boolean);
  result[pathKey] = [...directories, ...inherited].join(platform === 'win32' ? ';' : ':');
  return result;
}

function validateCommand(command, args) {
  if (command !== 'aks-devctl') return;
  const invalid = () => {
    throw new Error('The aks-devctl request is outside the Windows local-cluster POC contract');
  };
  if (!Array.isArray(args) || args.some(value => typeof value !== 'string')) invalid();
  if (args[0] !== 'cluster') invalid();
  const subcommand = args[1];
  if (args.length === 3 && subcommand === 'get-versions' && args[2] === '--json') return;
  // create takes the full local topology; show and delete accept only the flags that find the
  // guest (aks-devctl cmd/aks-devctl/flags.go, newScopedFlags).
  const guest = ['--json', '--provider', 'wsl', '--distro', 'Ubuntu-24.04'];
  const local = [
    '--json', '--provider', 'wsl', '--distro', 'Ubuntu-24.04',
    '--kubernetes-distribution', 'K8s', '--agent-connectivity', 'shared',
    '--wsl-control-plane-ip', 'off',
  ];
  if (!['show', 'create', 'delete'].includes(subcommand)) invalid();
  const prefix = subcommand === 'create' ? local : guest;
  if (prefix.some((value, index) => args[index + 2] !== value)) invalid();
  const rest = args.slice(prefix.length + 2);
  if (subcommand === 'show') {
    if (rest.length !== 0) invalid();
    return;
  }
  if (rest[0] !== '--name' || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(rest[1] ?? '')) {
    invalid();
  }
  if (subcommand === 'delete') {
    // The CLI prunes the cluster's entries from the default kubeconfig after teardown; full
    // delete on the AKS Local Overview appends --purge.
    if (rest[2] !== '--prune-kubeconfig') invalid();
    if (rest.length === 4 && rest[3] === '--purge') return;
    if (rest.length !== 3) invalid();
    return;
  }
  if (rest[2] !== '--kubernetes-version' || !/^v\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(rest[3] ?? '')) {
    invalid();
  }
  // Create merges the credentials into the default kubeconfig without a flag; an NVIDIA GPU
  // create appends exactly these arguments.
  const gpu = ['--enable-gpu', '--gpu-vendor', 'nvidia'];
  const extra = rest.slice(4);
  if (extra.length === 0) return;
  if (extra.length !== gpu.length || gpu.some((value, index) => extra[index] !== value)) invalid();
}

function stageAksToolEnvironment(resourcesDirectory) {
  const directory = path.join(resourcesDirectory, 'external-tools');
  fs.mkdirSync(directory, { recursive: true });
  fs.copyFileSync(__filename, path.join(directory, path.basename(__filename)));
}

module.exports = {
  configureEnvironment: withAksToolPaths,
  withAksToolPaths,
  stageAksToolEnvironment,
  validateCommand,
};
