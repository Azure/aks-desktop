/**
 * Resolves the build architecture from npm's target environment or the current host.
 *
 * @returns The requested target architecture.
 */
function targetArchitecture(): string {
  return process.env.npm_config_target_arch || process.env.npm_config_arch || process.arch;
}

/**
 * Selects consumer-owned tools and grants before serializing runtime metadata.
 *
 * @param entries - Tool or grant records with optional build-only target constraints.
 * @param platform - Requested operating-system target.
 * @param arch - Requested architecture target.
 * @returns Matching records without build-only metadata; unconstrained entries remain included.
 */
function selectBuildTarget<T extends { targets?: unknown }>(
  entries: readonly T[],
  platform = process.platform,
  arch = targetArchitecture()
): Omit<T, 'targets'>[] {
  return entries
    .filter(entry => {
      if (entry.targets === undefined) return true;
      if (
        !Array.isArray(entry.targets) ||
        entry.targets.length === 0 ||
        !entry.targets.every(
          target => typeof target === 'string' && /^(linux|darwin|win32)-(x64|arm64)$/.test(target)
        )
      ) {
        throw new Error(
          'Build targets must be a non-empty array of supported platform-architecture pairs'
        );
      }
      return entry.targets.includes(`${platform}-${arch}`);
    })
    .map(({ targets: _targets, ...entry }) => entry);
}

module.exports = { selectBuildTarget, targetArchitecture };
