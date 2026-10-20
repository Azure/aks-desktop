/**
 * Resolves npm lifecycle commands and provides portable sync and async process launchers.
 * Run `npm --prefix packages/headlamp-source run test:helpers` for coverage.
 */
const crossSpawn = require('cross-spawn');

/**
 * Resolves npm through its JavaScript CLI, falling back to the platform command on PATH.
 *
 * @param args - Arguments passed to npm.
 * @param platform - Platform used to select the npm command shim.
 * @param env - Environment containing npm lifecycle metadata.
 * @param nodeExecutable - Node executable used to run npm's JavaScript CLI.
 * @returns The executable and arguments for the cross-platform process launchers.
 */
function npmInvocation(
  args,
  platform = process.platform,
  env = process.env,
  nodeExecutable = process.execPath
) {
  return env.npm_execpath
    ? { command: nodeExecutable, args: [env.npm_execpath, ...args] }
    : { command: platform === 'win32' ? 'npm.cmd' : 'npm', args };
}

module.exports = { npmInvocation, spawn: crossSpawn, spawnSync: crossSpawn.sync };