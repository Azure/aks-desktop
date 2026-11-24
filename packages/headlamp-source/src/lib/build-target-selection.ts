/**
 * Resolves the build architecture from npm's target environment or the current host.
 *
 * @returns The requested target architecture.
 */
function targetArchitecture(): string {
  return process.env.npm_config_target_arch || process.env.npm_config_arch || process.arch;
}

/**
 * Selects the run-command policies of the build target before serializing runtime metadata.
 *
 * @param policies - Policies with an optional build-only `targets` constraint.
 * @param platform - Requested operating-system target.
 * @param arch - Requested architecture target.
 * @returns Matching policies without `targets`; unconstrained policies remain included.
 */
function selectBuildTarget<T extends { targets?: unknown }>(
  policies: readonly T[],
  platform = process.platform,
  arch = targetArchitecture()
): Omit<T, 'targets'>[] {
  return policies
    .filter(policy => {
      if (policy.targets === undefined) return true;
      if (
        !Array.isArray(policy.targets) ||
        policy.targets.length === 0 ||
        !policy.targets.every(
          target => typeof target === 'string' && /^(linux|darwin|win32)-(x64|arm64)$/.test(target)
        )
      ) {
        throw new Error(
          'Build targets must be a non-empty array of supported platform-architecture pairs'
        );
      }
      return policy.targets.includes(`${platform}-${arch}`);
    })
    .map(({ targets: _targets, ...policy }) => policy);
}

module.exports = { selectBuildTarget, targetArchitecture };
