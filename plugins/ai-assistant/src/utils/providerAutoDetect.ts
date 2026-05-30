import { runCommand } from '@kinvolk/headlamp-plugin/lib';
import { getDefaultConfig } from '../config/modelConfig';
import type { StoredProviderConfig } from './ProviderConfigManager';

/**
 * pluginRunCommand is injected by Headlamp's plugin runner as a function-scope
 * variable (via `new Function('pluginRunCommand', ..., pluginCode)`). Using
 * `declare const` lets TypeScript + Webpack reference it as a free variable
 * that resolves from the scope chain — NOT from globalThis.
 *
 * This must match the pattern used in aksAgentManager.ts.
 */
declare const pluginRunCommand: typeof runCommand;

/**
 * Sentinel value stored in config.apiKey for the copilot provider
 * when it was auto-detected via `gh auth token`. The actual token
 * is never persisted — it is fetched fresh from the CLI at model
 * creation time via {@link refreshGitHubToken}.
 */
export const GH_CLI_AUTH_SENTINEL = '__gh_cli__';

/**
 * Sentinel value stored in config.apiKey for the azure provider
 * when it was auto-detected via `az cognitiveservices account keys list`.
 * The actual key is never persisted — it is fetched fresh from the CLI
 * at model creation time via {@link refreshAzureOpenAIKey}.
 *
 * When this sentinel is used, `config.azResourceGroup` and
 * `config.azAccountName` are also stored so the key can be re-fetched.
 */
export const AZ_CLI_AUTH_SENTINEL = '__az_cli__';

/**
 * Represents a detected AI provider that can be auto-configured.
 */
export interface DetectedProvider {
  /** The provider ID from modelConfig (e.g. 'copilot', 'local') */
  providerId: string;
  /** Human-readable label for the detection source */
  source: string;
  /** Pre-filled configuration for this provider */
  config: Record<string, any>;
  /** Friendly display name for this configuration */
  displayName: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Allowlist of commands and their permitted first subcommands.
 * Prevents arbitrary command execution via the pluginRunCommand bridge.
 */
const ALLOWED_COMMANDS: Record<string, string[]> = {
  gh: ['auth'],
  az: ['account', 'cognitiveservices'],
};

/** Maximum time (ms) to wait for a CLI command before timing out. */
const DETECT_COMMAND_TIMEOUT_MS = 15_000;

/**
 * Run an allow-listed command via pluginRunCommand (Headlamp's Electron
 * bridge). Returns { stdout, exitCode }. Always resolves — never rejects.
 *
 * Only commands registered in {@link ALLOWED_COMMANDS} are executed; any
 * other command resolves immediately with an error. A hard timeout ensures
 * hung processes don't stall auto-detection indefinitely.
 */
function runDetectCommand(
  command: string,
  args: string[]
): Promise<{ stdout: string; exitCode: number }> {
  // Validate against allowlist
  const allowedSubs = ALLOWED_COMMANDS[command];
  if (!allowedSubs) {
    console.debug(`[ai-assistant auto-detect] command "${command}" not in allowlist, skipping`);
    return Promise.resolve({ stdout: '', exitCode: 1 });
  }
  const firstSub = args[0];
  if (firstSub && !allowedSubs.includes(firstSub)) {
    console.debug(
      `[ai-assistant auto-detect] subcommand "${firstSub}" not allowed for "${command}", skipping`
    );
    return Promise.resolve({ stdout: '', exitCode: 1 });
  }

  return new Promise(resolve => {
    try {
      if (typeof pluginRunCommand === 'undefined') {
        console.debug(
          '[ai-assistant auto-detect] pluginRunCommand is undefined — not running in desktop mode'
        );
        resolve({ stdout: '', exitCode: 1 });
        return;
      }

      console.debug(
        `[ai-assistant auto-detect] running: ${command} ${args.join(
          ' '
        )} (pluginRunCommand type: ${typeof pluginRunCommand})`
      );

      // @ts-ignore — pluginRunCommand type is narrower than what we call
      const cmd = pluginRunCommand(command, args, {});

      let stdout = '';
      let stderr = '';
      let resolved = false;

      const done = (result: { stdout: string; exitCode: number }) => {
        if (!resolved) {
          resolved = true;
          resolve(result);
        }
      };

      // Hard timeout so a hanging CLI never stalls detection.
      const timer = setTimeout(() => {
        console.debug(
          `[ai-assistant auto-detect] timeout (${DETECT_COMMAND_TIMEOUT_MS}ms) for: ${command} ${args.join(
            ' '
          )}`
        );
        done({ stdout: '', exitCode: 1 });
      }, DETECT_COMMAND_TIMEOUT_MS);

      cmd.stdout.on('data', (data: string) => (stdout += data));
      // stderr is captured for debugging but not used for success/failure
      // decisions — many CLIs (notably `az`) emit warnings on stderr even
      // on success. We key off exitCode instead.
      cmd.stderr.on('data', (data: string) => (stderr += data));
      cmd.on('exit', (code: number | null) => {
        clearTimeout(timer);
        const exitCode = code ?? 1;
        // Negative exit codes come from the Headlamp Electron layer, not the CLI:
        //   -1 = command not in validCommands (validateCommandData failed)
        //   -2 = permission secret mismatch (runCmd-<cmd> secret missing)
        //   -3 = user denied consent dialog
        const codeHint =
          exitCode === -1
            ? ' (Electron: command not in validCommands — is the headlamp diff applied?)'
            : exitCode === -2
            ? ' (Electron: permission secret mismatch — runCmd-' + command + ' missing)'
            : exitCode === -3
            ? ' (Electron: user denied consent)'
            : '';
        console.debug(
          `[ai-assistant auto-detect] ${command} ${args.join(
            ' '
          )} exited with code ${exitCode}${codeHint}, stdout length ${stdout.length}${
            stderr ? ', stderr: ' + stderr.slice(0, 200) : ''
          }`
        );
        done({ stdout, exitCode });
      });
      cmd.on('error', (err: unknown) => {
        clearTimeout(timer);
        console.debug(`[ai-assistant auto-detect] ${command} error:`, err);
        done({ stdout: '', exitCode: 1 });
      });
    } catch (e) {
      console.debug('[ai-assistant auto-detect] runDetectCommand exception:', e);
      resolve({ stdout: '', exitCode: 1 });
    }
  });
}

// ---------------------------------------------------------------------------
// GitHub CLI detection
// ---------------------------------------------------------------------------

/**
 * Attempts to retrieve a GitHub token from the `gh` CLI (`gh auth token`).
 * Returns the token string if available, or null.
 */
export async function detectGitHubToken(): Promise<string | null> {
  console.debug('[ai-assistant auto-detect] checking GitHub CLI (gh auth token)...');
  const { stdout, exitCode } = await runDetectCommand('gh', ['auth', 'token']);
  if (exitCode !== 0 || !stdout) {
    console.debug(
      `[ai-assistant auto-detect] gh auth token failed: exitCode=${exitCode}, stdout="${stdout}"`
    );
    return null;
  }
  const token = stdout.trim();
  // Basic sanity check — GitHub tokens are at least 30 characters
  if (token.length < 30) {
    console.debug(`[ai-assistant auto-detect] gh token too short (${token.length} chars)`);
    return null;
  }
  console.debug('[ai-assistant auto-detect] gh auth token succeeded');
  return token;
}

/**
 * Validate a GitHub token against the GitHub API.
 * Returns the authenticated username, or null if invalid.
 */
export async function validateGitHubToken(token: string): Promise<string | null> {
  try {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json',
      },
    });
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    return data.login || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Copilot model detection via api.githubcopilot.com/models
// ---------------------------------------------------------------------------

interface CopilotModelEntry {
  id?: string;
  supported_endpoints?: string[];
}

interface CopilotModelsResponse {
  data?: CopilotModelEntry[];
}

function parseCopilotModelsResponse(raw: string): string[] {
  try {
    const payload = JSON.parse(raw) as CopilotModelsResponse;
    const entries = payload.data || [];
    return entries
      .filter(
        m =>
          m.id &&
          Array.isArray(m.supported_endpoints) &&
          m.supported_endpoints.includes('/chat/completions')
      )
      .map(m => m.id!);
  } catch {
    return [];
  }
}

/**
 * Fetch the list of Copilot models that support /chat/completions.
 *
 * Returns:
 * - `string[]` — the available model IDs (may be empty if the response parsed to nothing)
 * - `null` — the server returned a non-OK status (e.g. 401/403), meaning the token
 *   does not have Copilot access. Callers should treat `null` as "Copilot not available".
 */
export async function detectCopilotChatModels(token: string): Promise<string[] | null> {
  try {
    const response = await fetch('https://api.githubcopilot.com/models', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });
    if (response.ok) {
      const models = parseCopilotModelsResponse(await response.text());
      console.debug(`[ai-assistant auto-detect] copilot models: ${models.join(', ') || 'none'}`);
      return models;
    }
    // Non-OK (401, 403, …) — token is valid for GitHub but not for Copilot.
    console.debug(
      `[ai-assistant auto-detect] copilot models endpoint returned ${response.status} — account does not have Copilot access`
    );
    return null;
  } catch {
    // CORS or network error — unable to determine access; fall back to empty list
    // so detection can still proceed with the configured default model.
  }

  return [];
}

/**
 * Priority list for picking the best available Copilot chat model.
 * Ordered best-first; bare model IDs as returned by api.githubcopilot.com/models.
 * Prefers Claude Opus (highest quality), then GPT-5.x, then Claude Sonnet/Haiku,
 * then legacy GPT-4.x as a last resort.
 */
const COPILOT_CHAT_MODEL_PRIORITY = [
  // Claude Opus 4.x — highest quality tier
  // 'claude-opus-4.8',
  // 'claude-opus-4.7-xhigh',
  // 'claude-opus-4.7-high',
  'claude-opus-4.7',
  'claude-opus-4.6',
  'claude-opus-4.5',
  // GPT-5.x
  'gpt-5.4',
  'gpt-5.2',
  // Claude Sonnet — mid tier
  'claude-sonnet-4.6',
  'claude-sonnet-4.5',
  // GPT-5 mini
  'gpt-5-mini',
  // Claude Haiku — fast/cheap
  'claude-haiku-4.5',
  // Legacy GPT-4.x fallbacks
  'gpt-4.1',
  'gpt-4o',
  'gpt-4.1-mini',
  'gpt-4o-mini',
];

/**
 * Pick the best available model from the detected list.
 * Returns the model ID exactly as detected (bare ID, no provider prefix added).
 * Falls back to `fallback` if the list is empty or nothing preferred is found.
 */
export function pickBestCopilotChatModel(available: string[], fallback: string): string {
  if (!available.length) return fallback;

  // Strip provider prefix for comparison (e.g. "openai/gpt-4o" → "gpt-4o").
  const stripPrefix = (id: string) => id.replace(/^[^/]+\//, '').toLowerCase();
  const availNorm = available.map(stripPrefix);

  for (const preferred of COPILOT_CHAT_MODEL_PRIORITY) {
    const idx = availNorm.indexOf(preferred.toLowerCase());
    if (idx >= 0) {
      return available[idx];
    }
  }

  // None matched preferred list — take first available.
  return available[0];
}

/**
 * Detects whether the GitHub CLI is authenticated and returns a
 * provider config for GitHub Copilot (GitHub Models API) if so.
 *
 * **Security:** The actual token is NOT stored in the returned config.
 * Instead, a sentinel value ({@link GH_CLI_AUTH_SENTINEL}) is stored,
 * and the real token is fetched fresh via {@link refreshGitHubToken}
 * each time the model is created.
 */
export async function detectCopilotProvider(): Promise<DetectedProvider | null> {
  console.debug('[ai-assistant auto-detect] starting copilot provider detection...');
  const token = await detectGitHubToken();
  if (!token) {
    console.debug('[ai-assistant auto-detect] no GitHub token — skipping copilot provider');
    return null;
  }

  console.debug('[ai-assistant auto-detect] validating GitHub token...');
  const username = await validateGitHubToken(token);
  if (!username) {
    console.debug('[ai-assistant auto-detect] GitHub token validation failed');
    return null;
  }
  console.debug(`[ai-assistant auto-detect] GitHub token valid for user: ${username}`);

  const defaults = getDefaultConfig('copilot');
  const fallbackModel = String(defaults.model || 'gpt-5.4');

  const chatModels = await detectCopilotChatModels(token);
  if (chatModels === null) {
    // The Copilot API explicitly rejected the token — the account does not have
    // Copilot access. Do not create a provider that will fail at chat time.
    console.debug(
      '[ai-assistant auto-detect] copilot models endpoint denied access — skipping copilot provider'
    );
    return null;
  }
  console.debug(
    `[ai-assistant auto-detect] copilot available chat models: ${
      chatModels.join(', ') || 'none — using configured default'
    }`
  );
  const selectedModel = pickBestCopilotChatModel(chatModels, fallbackModel);
  console.debug(`[ai-assistant auto-detect] copilot selected model: ${selectedModel}`);

  return {
    providerId: 'copilot',
    source: 'GitHub CLI',
    config: {
      ...defaults,
      // Store a sentinel — never persist the real token to disk.
      apiKey: GH_CLI_AUTH_SENTINEL,
      model: selectedModel,
    },
    displayName: `GitHub Copilot (${username})`,
  };
}

/**
 * Fetch a fresh GitHub CLI token for the copilot provider.
 *
 * Call this at model creation time instead of using a stored token.
 * Returns the token string, or null if `gh` is unavailable / not logged in.
 */
export async function refreshGitHubToken(): Promise<string | null> {
  return detectGitHubToken();
}

// ---------------------------------------------------------------------------
// Ollama (local model) detection
// ---------------------------------------------------------------------------

interface OllamaModel {
  name: string;
}

/**
 * Detects whether Ollama is running locally and returns available models.
 */
export async function detectOllamaProvider(): Promise<DetectedProvider | null> {
  console.debug('[ai-assistant auto-detect] checking Ollama at localhost:11434...');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000);

  try {
    const response = await fetch('http://localhost:11434/api/tags', {
      signal: controller.signal,
    });

    if (!response.ok) {
      console.debug(`[ai-assistant auto-detect] Ollama returned status ${response.status}`);
      return null;
    }

    const data = await response.json();
    const models: OllamaModel[] = data.models || [];
    if (models.length === 0) {
      console.debug('[ai-assistant auto-detect] Ollama running but no models found');
      return null;
    }

    // Pick the first available model as default
    const firstModel = models[0].name;
    console.debug(
      `[ai-assistant auto-detect] Ollama detected with ${models.length} model(s), using: ${firstModel}`
    );

    return {
      providerId: 'local',
      source: 'Ollama',
      config: {
        baseUrl: 'http://localhost:11434',
        model: firstModel,
      },
      displayName: `Ollama (${firstModel})`,
    };
  } catch (e) {
    console.debug('[ai-assistant auto-detect] Ollama not reachable:', e);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// Azure OpenAI detection via `az` CLI
// ---------------------------------------------------------------------------

interface AzureOpenAIAccount {
  name: string;
  properties?: {
    endpoint?: string;
  };
  resourceGroup?: string;
}

interface AzureOpenAIDeployment {
  name: string;
  properties?: {
    model?: {
      name?: string;
    };
    /** Capability flags returned by `az cognitiveservices account deployment list`.
     * Keys include `"chatCompletion"`, `"embeddings"`, `"completion"`, etc.
     * Values are string booleans (e.g. `"true"` / `"false"`). */
    capabilities?: Record<string, string>;
  };
}

/**
 * Returns true if the deployment supports chat completions.
 *
 * Prefers the explicit `chatCompletion` capability flag when present.
 * Falls back to model-name heuristics for older API responses that omit
 * the capabilities map (excludes embedding, Whisper, TTS, and DALL-E models).
 */
function isChatDeployment(deployment: AzureOpenAIDeployment): boolean {
  const caps = deployment.properties?.capabilities;
  if (caps) {
    if (caps['chatCompletion'] === 'true') return true;
    if (caps['embeddings'] === 'true') return false;
  }
  // Heuristic fallback: exclude known non-chat model families by name.
  const modelName = (deployment.properties?.model?.name ?? '').toLowerCase();
  return (
    !modelName.includes('embedding') &&
    !modelName.includes('whisper') &&
    !modelName.includes('tts') &&
    !modelName.includes('dall-e')
  );
}

/**
 * Check whether the Azure CLI is logged in by running `az account show`.
 * Returns the subscription display name, or null if not logged in.
 */
async function checkAzureLogin(): Promise<string | null> {
  console.debug('[ai-assistant auto-detect] checking Azure CLI login (az account show)...');
  const { stdout, exitCode } = await runDetectCommand('az', ['account', 'show', '-o', 'json']);
  if (exitCode !== 0 || !stdout) {
    console.debug(
      `[ai-assistant auto-detect] az account show failed: exitCode=${exitCode}, stdout="${stdout}"`
    );
    return null;
  }
  try {
    const account = JSON.parse(stdout);
    const name = account.name || account.user?.name || 'Azure';
    console.debug(`[ai-assistant auto-detect] Azure CLI logged in: ${name}`);
    return name;
  } catch (e) {
    console.debug('[ai-assistant auto-detect] az account show JSON parse error:', e);
    return null;
  }
}

/**
 * List Azure OpenAI (Cognitive Services) accounts in the current subscription.
 * Uses `az cognitiveservices account list` filtered to `kind == OpenAI`.
 */
async function listAzureOpenAIAccounts(): Promise<AzureOpenAIAccount[]> {
  const { stdout, exitCode } = await runDetectCommand('az', [
    'cognitiveservices',
    'account',
    'list',
    '--query',
    "[?kind=='OpenAI']",
    '-o',
    'json',
  ]);
  if (exitCode !== 0 || !stdout) {
    return [];
  }
  try {
    const accounts: AzureOpenAIAccount[] = JSON.parse(stdout);
    return Array.isArray(accounts) ? accounts : [];
  } catch {
    return [];
  }
}

/**
 * List model deployments for a specific Azure OpenAI resource.
 */
async function listAzureOpenAIDeployments(
  resourceGroup: string,
  accountName: string
): Promise<AzureOpenAIDeployment[]> {
  const { stdout, exitCode } = await runDetectCommand('az', [
    'cognitiveservices',
    'account',
    'deployment',
    'list',
    '-g',
    resourceGroup,
    '-n',
    accountName,
    '-o',
    'json',
  ]);
  if (exitCode !== 0 || !stdout) {
    return [];
  }
  try {
    const deployments: AzureOpenAIDeployment[] = JSON.parse(stdout);
    return Array.isArray(deployments) ? deployments : [];
  } catch {
    return [];
  }
}

/**
 * Retrieve an API key for an Azure OpenAI resource.
 */
async function getAzureOpenAIKey(
  resourceGroup: string,
  accountName: string
): Promise<string | null> {
  const { stdout, exitCode } = await runDetectCommand('az', [
    'cognitiveservices',
    'account',
    'keys',
    'list',
    '-g',
    resourceGroup,
    '-n',
    accountName,
    '-o',
    'json',
  ]);
  if (exitCode !== 0 || !stdout) {
    return null;
  }
  try {
    const keys = JSON.parse(stdout);
    return keys.key1 || keys.key2 || null;
  } catch {
    return null;
  }
}

/**
 * Detects whether the Azure CLI is logged in and finds Azure OpenAI
 * resources with deployments. Returns a provider config for the first
 * resource found, or null if none available.
 *
 * **Security:** The actual API key is NOT stored in the returned config.
 * Instead, a sentinel value ({@link AZ_CLI_AUTH_SENTINEL}) is stored,
 * together with `azResourceGroup` and `azAccountName` so the real key
 * can be fetched fresh via {@link refreshAzureOpenAIKey} at model
 * creation time.
 */
export async function detectAzureOpenAIProvider(): Promise<DetectedProvider | null> {
  console.debug('[ai-assistant auto-detect] starting Azure OpenAI provider detection...');
  const subscriptionName = await checkAzureLogin();
  if (!subscriptionName) {
    console.debug('[ai-assistant auto-detect] Azure CLI not logged in — skipping Azure provider');
    return null;
  }

  const accounts = await listAzureOpenAIAccounts();
  if (accounts.length === 0) {
    console.debug('[ai-assistant auto-detect] no Azure OpenAI accounts found');
    return null;
  }
  console.debug(`[ai-assistant auto-detect] found ${accounts.length} Azure OpenAI account(s)`);

  // Use the first account that has an endpoint and a resource group
  for (const account of accounts) {
    const endpoint = account.properties?.endpoint;
    const resourceGroup = account.resourceGroup;
    if (!endpoint || !resourceGroup) {
      continue;
    }

    // Get deployments for this account
    const deployments = await listAzureOpenAIDeployments(resourceGroup, account.name);
    const chatDeployments = deployments.filter(isChatDeployment);
    if (chatDeployments.length === 0) {
      console.debug(
        `[ai-assistant auto-detect] account "${account.name}" has ${deployments.length} deployment(s) but none support chat completions — skipping`
      );
      continue;
    }

    // Pick the first chat-capable deployment
    const deployment = chatDeployments[0];
    const deploymentName = deployment.name;
    const modelName = deployment.properties?.model?.name || 'gpt-4';

    // Verify we can actually get an API key (validates permissions)
    const apiKey = await getAzureOpenAIKey(resourceGroup, account.name);
    if (!apiKey) {
      continue;
    }

    return {
      providerId: 'azure',
      source: 'Azure CLI',
      config: {
        // Store sentinel — never persist the real key to disk.
        apiKey: AZ_CLI_AUTH_SENTINEL,
        // Metadata needed to re-fetch the key at model creation time.
        azResourceGroup: resourceGroup,
        azAccountName: account.name,
        endpoint,
        deploymentName,
        model: modelName,
      },
      displayName: `Azure OpenAI (${account.name})`,
    };
  }

  return null;
}

/**
 * Fetch a fresh Azure OpenAI API key from the `az` CLI.
 *
 * Call this at model creation time when config.apiKey is
 * {@link AZ_CLI_AUTH_SENTINEL}. Returns the key string, or null
 * if `az` is unavailable / permissions are insufficient.
 */
export async function refreshAzureOpenAIKey(
  resourceGroup: string,
  accountName: string
): Promise<string | null> {
  return getAzureOpenAIKey(resourceGroup, accountName);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run all provider auto-detection checks.
 * Only returns providers that are not already configured.
 */
export async function detectProviders(
  existingProviders: StoredProviderConfig[]
): Promise<DetectedProvider[]> {
  console.debug(
    `[ai-assistant auto-detect] detectProviders called with ${existingProviders.length} existing provider(s):`,
    existingProviders.map(p => p.providerId)
  );
  console.debug(
    `[ai-assistant auto-detect] pluginRunCommand availability: ${typeof pluginRunCommand}`
  );

  const detected: DetectedProvider[] = [];

  // Check if a provider type is already configured
  const hasProvider = (providerId: string) =>
    existingProviders.some(p => p.providerId === providerId);

  const skipCopilot = hasProvider('copilot');
  const skipLocal = hasProvider('local');
  const skipAzure = hasProvider('azure');
  console.debug(
    `[ai-assistant auto-detect] skipping: copilot=${skipCopilot}, local=${skipLocal}, azure=${skipAzure}`
  );

  // Run detections in parallel
  const [copilot, ollama, azure] = await Promise.all([
    skipCopilot ? Promise.resolve(null) : detectCopilotProvider(),
    skipLocal ? Promise.resolve(null) : detectOllamaProvider(),
    skipAzure ? Promise.resolve(null) : detectAzureOpenAIProvider(),
  ]);

  if (copilot) detected.push(copilot);
  if (azure) detected.push(azure);
  if (ollama) detected.push(ollama);

  console.debug(
    `[ai-assistant auto-detect] detection complete: ${detected.length} provider(s) found`,
    detected.map(p => `${p.providerId} (${p.source})`)
  );

  return detected;
}
