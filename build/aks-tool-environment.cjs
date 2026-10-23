const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
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

function validateCommand(command, args, temporaryDirectory = os.tmpdir()) {
  if (command !== 'aksedge') return;
  const invalid = () => {
    throw new Error('The aksedge request is outside the Windows local-cluster POC contract');
  };
  if (!Array.isArray(args) || args.some(value => typeof value !== 'string')) invalid();
  if (args.length === 2 && args[0] === 'versions' && args[1] === '--json') return;
  const prefix = [
    '--json', '--driver', 'wsl', '--distro', 'Ubuntu-24.04',
    '--distribution', 'K8s', '--cni', 'cilium', '--reach', 'shared',
    '--wsl-stable-ip', 'off',
  ];
  if (!['status', 'create', 'kubeconfig', 'delete'].includes(args[0])) invalid();
  if (prefix.some((value, index) => args[index + 1] !== value)) invalid();
  const rest = args.slice(prefix.length + 1);
  if (args[0] === 'status') {
    if (rest.length !== 0) invalid();
    return;
  }
  if (
    rest[0] !== '--name' ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(rest[1] ?? '') ||
    rest[2] !== '--k8s-version' ||
    !/^\d{1,3}\.\d{1,3}\.\d{1,3}-\d{8}$/.test(rest[3] ?? '')
  ) invalid();
  if (args[0] === 'delete') {
    if (rest.length !== 4) invalid();
    return;
  }
  if (rest.length !== 6 || rest[4] !== '--kubeconfig-out') invalid();
  const output = rest[5];
  if (!path.isAbsolute(output) || output.includes('\0')) invalid();
  const root = fs.realpathSync(temporaryDirectory);
  const directory = path.dirname(output);
  if (
    path.dirname(directory) !== root ||
    !/^aksedge-kubeconfig-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      path.basename(directory)
    ) ||
    path.basename(output) !== 'credentials.yaml' ||
    fs.realpathSync(directory) !== directory
  ) invalid();
  const stat = fs.lstatSync(output);
  if (!stat.isFile() || stat.nlink !== 1 || fs.realpathSync(output) !== output) invalid();
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
