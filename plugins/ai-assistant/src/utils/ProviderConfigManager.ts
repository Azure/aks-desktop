/**
 * Utility functions for managing AI provider configurations
 */

export interface StoredProviderConfig {
  providerId: string;
  displayName?: string;
  config: Record<string, any>;
}

export interface SavedConfigurations {
  providers: StoredProviderConfig[];
  defaultProviderIndex?: number;
  termsAccepted?: boolean;
}

/**
 * Returns true when two stored provider configs refer to the same logical
 * configuration.
 *
 * For Azure sentinel configs (`apiKey === AZ_CLI_AUTH_SENTINEL`), the
 * account name is used as the primary identity because all auto-detected Azure
 * accounts share the same sentinel value. Matching on sentinel alone would
 * cause configs for different Azure accounts to be treated as identical.
 *
 * For providers without an API key (e.g. local/Ollama), `baseUrl`, `model`,
 * and ultimately a full config comparison are applied in sequence as
 * tiebreakers. Each mismatching field causes an early `false`; if all checked
 * fields agree the full configs are compared with `JSON.stringify` to catch
 * any remaining differences.
 *
 * For all other providers, `providerId + apiKey` uniquely identifies a config.
 */
export function isSameStoredConfig(a: StoredProviderConfig, b: StoredProviderConfig): boolean {
  if (a.providerId !== b.providerId) return false;
  if (a.config.apiKey !== b.config.apiKey) return false;
  // Tiebreaker for sentinel-keyed configs that carry per-account metadata.
  if (a.config.azAccountName && b.config.azAccountName) {
    return a.config.azAccountName === b.config.azAccountName;
  }
  // When neither config has an API key (e.g. local/Ollama), cascade through
  // baseUrl → model → full JSON comparison. An early mismatch on any field
  // returns false; agreement on all visible fields falls through to the full
  // comparison so any remaining differences are also caught.
  if (!a.config.apiKey && !b.config.apiKey) {
    if (a.config.baseUrl !== b.config.baseUrl) return false;
    if (a.config.model !== b.config.model) return false;
    return JSON.stringify(a.config) === JSON.stringify(b.config);
  }
  return true;
}

/**
 * Gets saved provider configurations from plugin data
 */
export function getSavedConfigurations(data: any): SavedConfigurations {
  if (!data) {
    return { providers: [] };
  }

  // Check for new format storage
  if (data.providers && Array.isArray(data.providers)) {
    return {
      providers: data.providers,
      defaultProviderIndex: data.defaultProviderIndex,
      termsAccepted: data.termsAccepted || false,
    };
  }

  // Create empty configuration if nothing is found
  const providers: StoredProviderConfig[] = [];

  return {
    providers,
    termsAccepted: false,
  };
}

/**
 * Gets the active configuration based on the default config
 */
export function getActiveConfig(
  savedConfigs: SavedConfigurations | null | undefined
): StoredProviderConfig | null {
  if (!savedConfigs?.providers || savedConfigs.providers.length === 0) {
    return null;
  }
  const defaultConfig = savedConfigs?.providers[savedConfigs.defaultProviderIndex || 0];
  if (defaultConfig) return defaultConfig;

  // Otherwise return the first one
  return savedConfigs?.providers[0];
}

/**
 * Saves or updates a provider configuration
 */
export function saveProviderConfig(
  savedConfigs: SavedConfigurations | null | undefined,
  providerId: string,
  config: Record<string, any>,
  makeDefault: boolean = false,
  displayName?: string
): SavedConfigurations {
  // Ensure we have a valid savedConfigs object
  const safeConfigs: SavedConfigurations = savedConfigs || { providers: [] };

  // Create new array to avoid modifying the original
  const providers: StoredProviderConfig[] =
    safeConfigs?.providers?.map(p => ({
      ...p,
    })) ?? [];

  // Check if this exact configuration already exists (by comparing display name or key fields)
  const existingIndex = providers.findIndex(p => {
    // If displayName is provided, use that as primary matching criteria
    if (displayName && p.displayName === displayName && p.providerId === providerId) {
      return true;
    }

    // Must match provider ID
    if (p.providerId !== providerId) return false;

    // If either config doesn't have API key or other identifying fields, they're not matching
    if ((!p.config.apiKey && config.apiKey) || (p.config.apiKey && !config.apiKey)) {
      return false;
    }

    // If API keys exist and match, consider a match (same account)
    if (p.config.apiKey && config.apiKey && p.config.apiKey === config.apiKey) {
      // For sentinel-keyed providers (e.g. Azure CLI auto-detect), the sentinel
      // is shared across all accounts. azAccountName is the primary identity:
      // same name → update in-place; different name → distinct entry.
      if (p.config.azAccountName && config.azAccountName) {
        return p.config.azAccountName === config.azAccountName;
      }

      // But if models or deployment names differ, they're different configs
      if (p.config.model && config.model && p.config.model !== config.model) {
        return false;
      }
      if (
        p.config.deploymentName &&
        config.deploymentName &&
        p.config.deploymentName !== config.deploymentName
      ) {
        return false;
      }

      // If we got here with matching API keys and no conflicting models/deployments,
      // consider it the same configuration
      return true;
    }

    // If baseURLs exist and match, consider a potential match
    if (p.config.baseUrl && config.baseUrl && p.config.baseUrl === config.baseUrl) {
      // For base URLs, we also need matching models to consider them the same config
      if (p.config.model && config.model && p.config.model === config.model) {
        return true;
      }
    }

    // Otherwise, consider it a different configuration
    return false;
  });

  // Create new config object
  const updatedConfig: StoredProviderConfig = {
    providerId,
    displayName:
      displayName || (existingIndex >= 0 ? providers[existingIndex]?.displayName : undefined),
    config: { ...config },
  };

  // Update or add the configuration
  if (existingIndex >= 0) {
    providers[existingIndex] = updatedConfig;
  } else {
    // This is a new configuration, add it to the list
    providers.push(updatedConfig);
  }

  // Set defaultProviderIndex if makeDefault is true
  let defaultProviderIndex = safeConfigs.defaultProviderIndex;
  if (makeDefault) {
    // If we're updating an existing provider
    if (existingIndex >= 0) {
      defaultProviderIndex = existingIndex;
    } else {
      // If we're adding a new provider
      defaultProviderIndex = providers.length - 1;
    }
  }

  // Return updated configurations
  return {
    providers,
    defaultProviderIndex,
    termsAccepted: safeConfigs.termsAccepted || false,
  };
}

/**
 * Deletes a provider configuration
 */
export function deleteProviderConfig(
  savedConfigs: SavedConfigurations | null | undefined,
  providerId: string,
  config: Record<string, any>
): SavedConfigurations {
  // Ensure we have a valid savedConfigs object
  const safeConfigs: SavedConfigurations = savedConfigs || { providers: [] };

  // Create new array without the deleted config
  const providers = Array.isArray(safeConfigs?.providers)
    ? safeConfigs?.providers.filter(p => {
        if (p.providerId !== providerId) return true;

        if (p.config.apiKey && config.apiKey) {
          if (p.config.apiKey !== config.apiKey) return true;
          // For sentinel-keyed providers (e.g. Azure CLI), the sentinel is shared
          // across accounts. Use azAccountName to distinguish them so deleting one
          // Azure account does not remove all others with the same sentinel.
          if (p.config.azAccountName || config.azAccountName) {
            return p.config.azAccountName !== config.azAccountName;
          }
          return JSON.stringify(p.config) !== JSON.stringify(config);
        }
        if (p.config.baseUrl && config.baseUrl) {
          return p.config.baseUrl !== config.baseUrl;
        }

        return JSON.stringify(p.config) !== JSON.stringify(config);
      })
    : [];

  // If we deleted the default provider and have others left, make the first one the default
  const defaultProviderIndex =
    providers.length > 0
      ? safeConfigs.defaultProviderIndex !== undefined
        ? Math.min(safeConfigs.defaultProviderIndex, providers.length - 1)
        : 0
      : undefined;

  return {
    providers,
    defaultProviderIndex,
    termsAccepted: safeConfigs.termsAccepted || false,
  };
}

/**
 * Saves the terms acceptance status
 */
export function saveTermsAcceptance(
  savedConfigs: SavedConfigurations | null | undefined
): SavedConfigurations {
  const safeConfigs = savedConfigs || { providers: [] };

  return {
    ...safeConfigs,
    termsAccepted: true,
  };
}
