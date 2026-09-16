const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function withAksToolPaths(environment, manifest, resourcesDirectory, platform = process.platform) {
  const tools = manifest['external-tools'];
  if (!Array.isArray(tools)) throw new Error('AKS external-tools must be an array');
  const directories = new Set();
  for (const tool of tools) {
    const entry = tool?.platforms?.[platform];
    if (entry === undefined) continue;
    if (
      typeof entry.path !== 'string' || !entry.path ||
      path.posix.isAbsolute(entry.path) || path.win32.isAbsolute(entry.path) ||
      typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(entry.sha256)
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
      canonicalRelative === '..' || canonicalRelative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(canonicalRelative) || !fs.statSync(canonical).isFile()
    ) {
      throw new Error(`AKS tool escapes resources or is not a file: ${tool.id}`);
    }
    const digest = crypto.createHash('sha256').update(fs.readFileSync(canonical)).digest('hex');
    if (digest !== entry.sha256.toLowerCase()) throw new Error(`AKS tool integrity mismatch: ${tool.id}`);
    directories.add(path.dirname(candidate));
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

function stageAksToolEnvironment(resourcesDirectory) {
  const directory = path.join(resourcesDirectory, 'external-tools');
  fs.mkdirSync(directory, { recursive: true });
  fs.copyFileSync(__filename, path.join(directory, path.basename(__filename)));
}

module.exports = { configureEnvironment: withAksToolPaths, withAksToolPaths, stageAksToolEnvironment };