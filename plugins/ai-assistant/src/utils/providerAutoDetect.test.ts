import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DetectedProvider } from './providerAutoDetect';

// Mock globals before importing the module.
// `vi.stubGlobal` sets the variable on globalThis AND in the module scope
// (via the test environment). This is needed because providerAutoDetect.ts
// uses `declare const pluginRunCommand` which resolves from the scope chain.
const mockPluginRunCommand = vi.fn();

beforeEach(() => {
  vi.stubGlobal('pluginRunCommand', mockPluginRunCommand);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('providerAutoDetect', () => {
  describe('detectGitHubToken', () => {
    it('returns token when gh auth token succeeds', async () => {
      const fakeToken = 'ghp_' + 'a'.repeat(36);
      mockPluginRunCommand.mockReturnValue({
        stdout: {
          on: (evt: string, cb: (data: string) => void) => evt === 'data' && cb(fakeToken),
        },
        stderr: { on: vi.fn() },
        on: (evt: string, cb: (code: number) => void) => evt === 'exit' && cb(0),
      });

      const { detectGitHubToken } = await import('./providerAutoDetect');
      const token = await detectGitHubToken();
      expect(token).toBe(fakeToken);
    });

    it('returns null when gh is not available', async () => {
      // pluginRunCommand not available
      vi.stubGlobal('pluginRunCommand', undefined);

      const { detectGitHubToken } = await import('./providerAutoDetect');
      const token = await detectGitHubToken();
      expect(token).toBeNull();
    });

    it('returns null when gh auth token fails', async () => {
      mockPluginRunCommand.mockReturnValue({
        stdout: { on: vi.fn() },
        stderr: {
          on: (evt: string, cb: (data: string) => void) => evt === 'data' && cb('not logged in'),
        },
        on: (evt: string, cb: (code: number) => void) => evt === 'exit' && cb(1),
      });

      const { detectGitHubToken } = await import('./providerAutoDetect');
      const token = await detectGitHubToken();
      expect(token).toBeNull();
    });

    it('returns null for short tokens', async () => {
      mockPluginRunCommand.mockReturnValue({
        stdout: { on: (evt: string, cb: (data: string) => void) => evt === 'data' && cb('short') },
        stderr: { on: vi.fn() },
        on: (evt: string, cb: (code: number) => void) => evt === 'exit' && cb(0),
      });

      const { detectGitHubToken } = await import('./providerAutoDetect');
      const token = await detectGitHubToken();
      expect(token).toBeNull();
    });
  });

  describe('validateGitHubToken', () => {
    it('returns username on valid token', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ login: 'testuser' }),
      } as Response);

      const { validateGitHubToken } = await import('./providerAutoDetect');
      const username = await validateGitHubToken('ghp_valid');
      expect(username).toBe('testuser');
      expect(fetchSpy).toHaveBeenCalledWith('https://api.github.com/user', expect.any(Object));
    });

    it('returns null on invalid token', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 401,
      } as Response);

      const { validateGitHubToken } = await import('./providerAutoDetect');
      const username = await validateGitHubToken('ghp_invalid');
      expect(username).toBeNull();
    });

    it('returns null on network error', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network error'));

      const { validateGitHubToken } = await import('./providerAutoDetect');
      const username = await validateGitHubToken('ghp_err');
      expect(username).toBeNull();
    });
  });

  describe('detectCopilotProvider — token security', () => {
    it('stores sentinel instead of real token in config', async () => {
      const fakeToken = 'ghp_' + 'a'.repeat(36);
      // First call: gh auth token. Subsequent gh api call returns token string
      // which fails JSON parse → falls back to fetch mock below.
      mockPluginRunCommand.mockReturnValue({
        stdout: {
          on: (evt: string, cb: (data: string) => void) => evt === 'data' && cb(fakeToken),
        },
        stderr: { on: vi.fn() },
        on: (evt: string, cb: (code: number) => void) => evt === 'exit' && cb(0),
      });

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        const urlString = String(url);
        if (urlString === 'https://api.github.com/user') {
          return { ok: true, json: async () => ({ login: 'testuser' }) } as Response;
        }
        if (urlString === 'https://api.githubcopilot.com/models') {
          return {
            ok: true,
            text: async () =>
              JSON.stringify({
                data: [
                  { id: 'gpt-5.4', supported_endpoints: ['/chat/completions'] },
                  { id: 'gpt-5.2', supported_endpoints: ['/chat/completions'] },
                  { id: 'claude-opus-4.6', supported_endpoints: ['/chat/completions'] },
                ],
              }),
          } as Response;
        }
        throw new Error(`unexpected url: ${urlString}`);
      });

      const { detectCopilotProvider, GH_CLI_AUTH_SENTINEL } = await import('./providerAutoDetect');
      const provider = await detectCopilotProvider();

      expect(provider).not.toBeNull();
      expect(provider!.config.apiKey).toBe(GH_CLI_AUTH_SENTINEL);
      // claude-opus-4.6 is highest priority among the mocked models (Claude Opus > GPT-5.x)
      expect(provider!.config.model).toBe('claude-opus-4.6');
      // The real token must NOT appear in the persisted config
      expect(provider!.config.apiKey).not.toBe(fakeToken);
    });

    it('picks best model from detected list, preferring gpt-4.1 over gpt-4o', async () => {
      const fakeToken = 'ghp_' + 'f'.repeat(36);
      mockPluginRunCommand.mockReturnValue({
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: (evt: string, cb: (code: number) => void) => {
          if (evt === 'data') return; // no stdout from gh api call
          if (evt === 'exit') cb(1); // make gh api fail → fall through to fetch
        },
      });
      // Override: first call (gh auth token) must succeed
      mockPluginRunCommand
        .mockReturnValueOnce({
          stdout: {
            on: (evt: string, cb: (data: string) => void) => evt === 'data' && cb(fakeToken),
          },
          stderr: { on: vi.fn() },
          on: (evt: string, cb: (code: number) => void) => evt === 'exit' && cb(0),
        })
        .mockReturnValue({
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: (evt: string, cb: (code: number) => void) => evt === 'exit' && cb(1),
        });

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        const urlString = String(url);
        if (urlString === 'https://api.github.com/user') {
          return { ok: true, json: async () => ({ login: 'testuser' }) } as Response;
        }
        if (urlString === 'https://api.githubcopilot.com/models') {
          return {
            ok: true,
            text: async () =>
              JSON.stringify({
                data: [
                  { id: 'gpt-5.2', supported_endpoints: ['/chat/completions'] },
                  { id: 'gpt-5.4', supported_endpoints: ['/chat/completions'] },
                  { id: 'text-embedding-3-large', supported_endpoints: ['/embeddings'] },
                ],
              }),
          } as Response;
        }
        throw new Error(`unexpected url: ${urlString}`);
      });

      const { detectCopilotProvider } = await import('./providerAutoDetect');
      const provider = await detectCopilotProvider();

      expect(provider).not.toBeNull();
      expect(provider!.config.model).toBe('gpt-5.4');
    });

    it('falls back to configured default when models endpoint is unavailable', async () => {
      const fakeToken = 'ghp_' + 'c'.repeat(36);
      mockPluginRunCommand.mockReturnValue({
        stdout: {
          on: (evt: string, cb: (data: string) => void) => evt === 'data' && cb(fakeToken),
        },
        stderr: { on: vi.fn() },
        on: (evt: string, cb: (code: number) => void) => evt === 'exit' && cb(0),
      });

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        const urlString = String(url);
        if (urlString === 'https://api.github.com/user') {
          return { ok: true, json: async () => ({ login: 'testuser' }) } as Response;
        }
        throw new Error(`unexpected url: ${urlString}`);
      });

      const { detectCopilotProvider } = await import('./providerAutoDetect');
      const provider = await detectCopilotProvider();

      expect(provider).not.toBeNull();
      expect(provider!.config.model).toBe('gpt-5.4');
    });

    it('uses configured default regardless of catalog availability', async () => {
      const fakeToken = 'ghp_' + 'c'.repeat(36);
      mockPluginRunCommand.mockReturnValue({
        stdout: {
          on: (evt: string, cb: (data: string) => void) => evt === 'data' && cb(fakeToken),
        },
        stderr: { on: vi.fn() },
        on: (evt: string, cb: (code: number) => void) => evt === 'exit' && cb(0),
      });

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        const urlString = String(url);
        if (urlString === 'https://api.github.com/user') {
          return { ok: true, json: async () => ({ login: 'testuser' }) } as Response;
        }
        throw new Error(`unexpected url: ${urlString}`);
      });

      const { detectCopilotProvider } = await import('./providerAutoDetect');
      const provider = await detectCopilotProvider();

      expect(provider).not.toBeNull();
      expect(provider!.config.model).toBe('gpt-5.4');
    });

    it('still uses default when catalog-like responses are absent', async () => {
      const fakeToken = 'ghp_' + 'd'.repeat(36);
      mockPluginRunCommand.mockReturnValue({
        stdout: {
          on: (evt: string, cb: (data: string) => void) => evt === 'data' && cb(fakeToken),
        },
        stderr: { on: vi.fn() },
        on: (evt: string, cb: (code: number) => void) => evt === 'exit' && cb(0),
      });

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        const urlString = String(url);
        if (urlString === 'https://api.github.com/user') {
          return { ok: true, json: async () => ({ login: 'testuser' }) } as Response;
        }
        throw new Error(`unexpected url: ${urlString}`);
      });

      const { detectCopilotProvider } = await import('./providerAutoDetect');
      const provider = await detectCopilotProvider();

      expect(provider).not.toBeNull();
      expect(provider!.config.model).toBe('gpt-5.4');
    });

    it('uses default even when mixed catalog responses would differ', async () => {
      const fakeToken = 'ghp_' + 'e'.repeat(36);
      mockPluginRunCommand.mockReturnValue({
        stdout: {
          on: (evt: string, cb: (data: string) => void) => evt === 'data' && cb(fakeToken),
        },
        stderr: { on: vi.fn() },
        on: (evt: string, cb: (code: number) => void) => evt === 'exit' && cb(0),
      });

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        const urlString = String(url);
        if (urlString === 'https://api.github.com/user') {
          return { ok: true, json: async () => ({ login: 'testuser' }) } as Response;
        }
        throw new Error(`unexpected url: ${urlString}`);
      });

      const { detectCopilotProvider } = await import('./providerAutoDetect');
      const provider = await detectCopilotProvider();

      expect(provider).not.toBeNull();
      expect(provider!.config.model).toBe('gpt-5.4');
    });
  });

  describe('refreshGitHubToken', () => {
    it('returns a fresh token from gh CLI', async () => {
      const fakeToken = 'ghp_' + 'b'.repeat(36);
      mockPluginRunCommand.mockReturnValue({
        stdout: {
          on: (evt: string, cb: (data: string) => void) => evt === 'data' && cb(fakeToken),
        },
        stderr: { on: vi.fn() },
        on: (evt: string, cb: (code: number) => void) => evt === 'exit' && cb(0),
      });

      const { refreshGitHubToken } = await import('./providerAutoDetect');
      const token = await refreshGitHubToken();
      expect(token).toBe(fakeToken);
    });

    it('returns null when gh is not available', async () => {
      vi.stubGlobal('pluginRunCommand', undefined);

      const { refreshGitHubToken } = await import('./providerAutoDetect');
      const token = await refreshGitHubToken();
      expect(token).toBeNull();
    });
  });

  describe('detectOllamaProvider', () => {
    it('returns provider when Ollama is running with models', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          models: [{ name: 'llama3' }, { name: 'mistral' }],
        }),
      } as Response);

      const { detectOllamaProvider } = await import('./providerAutoDetect');
      const provider = await detectOllamaProvider();
      expect(provider).not.toBeNull();
      expect(provider!.providerId).toBe('local');
      expect(provider!.config.model).toBe('llama3');
      expect(provider!.source).toBe('Ollama');
    });

    it('returns null when Ollama is not running', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

      const { detectOllamaProvider } = await import('./providerAutoDetect');
      const provider = await detectOllamaProvider();
      expect(provider).toBeNull();
    });

    it('returns null when Ollama has no models', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ models: [] }),
      } as Response);

      const { detectOllamaProvider } = await import('./providerAutoDetect');
      const provider = await detectOllamaProvider();
      expect(provider).toBeNull();
    });
  });

  describe('detectProviders', () => {
    it('skips providers that are already configured', async () => {
      // Mock that gh auth succeeds
      const fakeToken = 'ghp_' + 'a'.repeat(36);
      mockPluginRunCommand.mockReturnValue({
        stdout: {
          on: (evt: string, cb: (data: string) => void) => evt === 'data' && cb(fakeToken),
        },
        stderr: { on: vi.fn() },
        on: (evt: string, cb: (code: number) => void) => evt === 'exit' && cb(0),
      });

      // Mock fetch for GitHub API validation and Ollama
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        if (String(url) === 'https://api.github.com/user') {
          return { ok: true, json: async () => ({ login: 'testuser' }) } as Response;
        }
        // Ollama not running
        throw new Error('ECONNREFUSED');
      });

      const { detectProviders } = await import('./providerAutoDetect');

      // copilot already configured — should be skipped
      const result = await detectProviders([
        { providerId: 'copilot', config: { apiKey: 'existing' } },
      ]);

      // copilot should not be in results since it's already configured
      expect(result.find((p: DetectedProvider) => p.providerId === 'copilot')).toBeUndefined();
    });

    it('returns empty array when nothing is detected', async () => {
      // pluginRunCommand fails
      mockPluginRunCommand.mockImplementation(() => {
        throw new Error('not available');
      });

      // Ollama not running
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

      const { detectProviders } = await import('./providerAutoDetect');
      const result = await detectProviders([]);

      expect(result).toEqual([]);
    });
  });

  describe('detectAzureOpenAIProvider', () => {
    /**
     * Helper: set up mockPluginRunCommand to respond differently
     * depending on the command/args it receives.
     */
    function setupAzMock(responses: Record<string, { stdout: string; stderr: string }>) {
      mockPluginRunCommand.mockImplementation((command: string, args: string[]) => {
        const key = [command, ...args].join(' ');
        // Find the first registered key that appears as a prefix of the actual key
        const match = Object.keys(responses).find(k => key.startsWith(k));
        const resp = match ? responses[match] : { stdout: '', stderr: 'unknown command' };
        return {
          stdout: {
            on: (evt: string, cb: (data: string) => void) => {
              if (evt === 'data' && resp.stdout) cb(resp.stdout);
            },
          },
          stderr: {
            on: (evt: string, cb: (data: string) => void) => {
              if (evt === 'data' && resp.stderr) cb(resp.stderr);
            },
          },
          on: (evt: string, cb: (code: number) => void) => {
            if (evt === 'exit') cb(resp.stderr ? 1 : 0);
          },
        };
      });
    }

    it('returns provider when Azure CLI is logged in with OpenAI resources', async () => {
      const accountJson = JSON.stringify({
        name: 'My Subscription',
        user: { name: 'user@example.com' },
      });
      const resourcesJson = JSON.stringify([
        {
          name: 'my-openai',
          kind: 'OpenAI',
          resourceGroup: 'my-rg',
          properties: { endpoint: 'https://my-openai.openai.azure.com/' },
        },
      ]);
      const deploymentsJson = JSON.stringify([
        {
          name: 'gpt4-deploy',
          properties: { model: { name: 'gpt-4' } },
        },
      ]);
      const keysJson = JSON.stringify({ key1: 'azure-key-123', key2: 'azure-key-456' });

      setupAzMock({
        'az account show': { stdout: accountJson, stderr: '' },
        'az cognitiveservices account list': { stdout: resourcesJson, stderr: '' },
        'az cognitiveservices account deployment list': { stdout: deploymentsJson, stderr: '' },
        'az cognitiveservices account keys list': { stdout: keysJson, stderr: '' },
      });

      const { detectAzureOpenAIProvider, AZ_CLI_AUTH_SENTINEL } = await import(
        './providerAutoDetect'
      );
      const provider = await detectAzureOpenAIProvider();

      expect(provider).not.toBeNull();
      expect(provider!.providerId).toBe('azure');
      expect(provider!.source).toBe('Azure CLI');
      // Sentinel stored instead of real key
      expect(provider!.config.apiKey).toBe(AZ_CLI_AUTH_SENTINEL);
      expect(provider!.config.apiKey).not.toBe('azure-key-123');
      // Metadata for re-fetching the key
      expect(provider!.config.azResourceGroup).toBe('my-rg');
      expect(provider!.config.azAccountName).toBe('my-openai');
      expect(provider!.config.endpoint).toBe('https://my-openai.openai.azure.com/');
      expect(provider!.config.deploymentName).toBe('gpt4-deploy');
      expect(provider!.config.model).toBe('gpt-4');
      expect(provider!.displayName).toBe('Azure OpenAI (my-openai)');
    });

    it('returns null when Azure CLI is not logged in', async () => {
      setupAzMock({
        'az account show': { stdout: '', stderr: 'Please run az login' },
      });

      const { detectAzureOpenAIProvider } = await import('./providerAutoDetect');
      const provider = await detectAzureOpenAIProvider();
      expect(provider).toBeNull();
    });

    it('returns null when no Azure OpenAI resources exist', async () => {
      const accountJson = JSON.stringify({ name: 'Sub' });

      setupAzMock({
        'az account show': { stdout: accountJson, stderr: '' },
        'az cognitiveservices account list': { stdout: '[]', stderr: '' },
      });

      const { detectAzureOpenAIProvider } = await import('./providerAutoDetect');
      const provider = await detectAzureOpenAIProvider();
      expect(provider).toBeNull();
    });

    it('returns null when no deployments exist', async () => {
      const accountJson = JSON.stringify({ name: 'Sub' });
      const resourcesJson = JSON.stringify([
        {
          name: 'my-openai',
          kind: 'OpenAI',
          resourceGroup: 'my-rg',
          properties: { endpoint: 'https://my-openai.openai.azure.com/' },
        },
      ]);

      setupAzMock({
        'az account show': { stdout: accountJson, stderr: '' },
        'az cognitiveservices account list': { stdout: resourcesJson, stderr: '' },
        'az cognitiveservices account deployment list': { stdout: '[]', stderr: '' },
      });

      const { detectAzureOpenAIProvider } = await import('./providerAutoDetect');
      const provider = await detectAzureOpenAIProvider();
      expect(provider).toBeNull();
    });

    it('returns null when key retrieval fails', async () => {
      const accountJson = JSON.stringify({ name: 'Sub' });
      const resourcesJson = JSON.stringify([
        {
          name: 'my-openai',
          kind: 'OpenAI',
          resourceGroup: 'my-rg',
          properties: { endpoint: 'https://my-openai.openai.azure.com/' },
        },
      ]);
      const deploymentsJson = JSON.stringify([
        { name: 'deploy', properties: { model: { name: 'gpt-4' } } },
      ]);

      setupAzMock({
        'az account show': { stdout: accountJson, stderr: '' },
        'az cognitiveservices account list': { stdout: resourcesJson, stderr: '' },
        'az cognitiveservices account deployment list': { stdout: deploymentsJson, stderr: '' },
        'az cognitiveservices account keys list': { stdout: '', stderr: 'Access denied' },
      });

      const { detectAzureOpenAIProvider } = await import('./providerAutoDetect');
      const provider = await detectAzureOpenAIProvider();
      expect(provider).toBeNull();
    });

    it('skips resources without endpoint or resourceGroup', async () => {
      const accountJson = JSON.stringify({ name: 'Sub' });
      // Resource missing endpoint
      const resourcesJson = JSON.stringify([{ name: 'bad-resource', kind: 'OpenAI' }]);

      setupAzMock({
        'az account show': { stdout: accountJson, stderr: '' },
        'az cognitiveservices account list': { stdout: resourcesJson, stderr: '' },
      });

      const { detectAzureOpenAIProvider } = await import('./providerAutoDetect');
      const provider = await detectAzureOpenAIProvider();
      expect(provider).toBeNull();
    });
  });

  describe('refreshAzureOpenAIKey', () => {
    it('returns a fresh key from az CLI', async () => {
      const keysJson = JSON.stringify({ key1: 'fresh-azure-key', key2: 'key2' });
      mockPluginRunCommand.mockImplementation(() => ({
        stdout: {
          on: (evt: string, cb: (d: string) => void) => evt === 'data' && cb(keysJson),
        },
        stderr: { on: vi.fn() },
        on: (evt: string, cb: (code: number) => void) => evt === 'exit' && cb(0),
      }));

      const { refreshAzureOpenAIKey } = await import('./providerAutoDetect');
      const key = await refreshAzureOpenAIKey('my-rg', 'my-openai');
      expect(key).toBe('fresh-azure-key');
    });

    it('returns null when az CLI fails', async () => {
      mockPluginRunCommand.mockImplementation(() => ({
        stdout: { on: vi.fn() },
        stderr: {
          on: (evt: string, cb: (d: string) => void) => evt === 'data' && cb('Access denied'),
        },
        on: (evt: string, cb: (code: number) => void) => evt === 'exit' && cb(1),
      }));

      const { refreshAzureOpenAIKey } = await import('./providerAutoDetect');
      const key = await refreshAzureOpenAIKey('my-rg', 'my-openai');
      expect(key).toBeNull();
    });
  });
});
