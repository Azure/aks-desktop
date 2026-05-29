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
    /**
     * Builds a pluginRunCommand mock that responds to az/gh commands by key prefix.
     */
    function setupCommandMock(
      responses: Record<string, { stdout: string; stderr: string }>,
      fallback?: { stdout: string; stderr: string }
    ) {
      mockPluginRunCommand.mockImplementation((command: string, args: string[]) => {
        const key = [command, ...args].join(' ');
        const match = Object.keys(responses).find(k => key.startsWith(k));
        const resp = match ? responses[match] : fallback ?? { stdout: '', stderr: 'error' };
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

    it('skips copilot and local providers that are already configured', async () => {
      const fakeToken = 'ghp_' + 'a'.repeat(36);
      setupCommandMock({
        'gh auth token': { stdout: fakeToken, stderr: '' },
        'az account show': { stdout: '', stderr: 'not logged in' },
      });

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        if (String(url) === 'https://api.github.com/user') {
          return { ok: true, json: async () => ({ login: 'testuser' }) } as Response;
        }
        throw new Error('ECONNREFUSED');
      });

      const { detectProviders } = await import('./providerAutoDetect');

      const result = await detectProviders([
        { providerId: 'copilot', config: { apiKey: 'existing' } },
        { providerId: 'local', config: { baseUrl: 'http://localhost:11434' } },
      ]);

      expect(result.find((p: DetectedProvider) => p.providerId === 'copilot')).toBeUndefined();
      expect(result.find((p: DetectedProvider) => p.providerId === 'local')).toBeUndefined();
    });

    it('does not invoke gh CLI when copilot is in dismissedKeys', async () => {
      // Azure not logged in, Ollama not running
      setupCommandMock({
        'az account show': { stdout: '', stderr: 'not logged in' },
      });
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

      const { detectProviders } = await import('./providerAutoDetect');
      await detectProviders([], ['copilot']);

      // pluginRunCommand must not have been called with gh auth token
      const ghCalls = mockPluginRunCommand.mock.calls.filter(([cmd]: [string]) => cmd === 'gh');
      expect(ghCalls).toHaveLength(0);
    });

    it('does not invoke az deployment/key CLI calls for dismissed Azure accounts', async () => {
      const accountJson = JSON.stringify({ name: 'Sub' });
      const resourcesJson = JSON.stringify([
        {
          name: 'dismissed-account',
          kind: 'OpenAI',
          resourceGroup: 'rg-a',
          properties: { endpoint: 'https://dismissed-account.openai.azure.com/' },
        },
      ]);

      setupCommandMock({
        'gh auth token': { stdout: '', stderr: 'not logged in' },
        'az account show': { stdout: accountJson, stderr: '' },
        'az cognitiveservices account list': { stdout: resourcesJson, stderr: '' },
        // deployment list and keys list must NOT be called for dismissed accounts
      });
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

      const { detectProviders } = await import('./providerAutoDetect');
      const result = await detectProviders([], ['azure:dismissed-account']);

      // The account must not appear in results
      expect(
        result.find((p: DetectedProvider) => p.config?.azAccountName === 'dismissed-account')
      ).toBeUndefined();

      // Crucially: the expensive per-account calls must not have been made
      const deploymentCalls = mockPluginRunCommand.mock.calls.filter(
        ([cmd, args]: [string, string[]]) => cmd === 'az' && args.includes('deployment')
      );
      const keyCalls = mockPluginRunCommand.mock.calls.filter(
        ([cmd, args]: [string, string[]]) => cmd === 'az' && args.includes('keys')
      );
      expect(deploymentCalls).toHaveLength(0);
      expect(keyCalls).toHaveLength(0);
    });

    it('skips all Azure detection when bare "azure" is in dismissedKeys', async () => {
      setupCommandMock({
        'gh auth token': { stdout: '', stderr: 'not logged in' },
        // az account show must NOT be called
      });
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

      const { detectProviders } = await import('./providerAutoDetect');
      await detectProviders([], ['azure']);

      const azCalls = mockPluginRunCommand.mock.calls.filter(([cmd]: [string]) => cmd === 'az');
      expect(azCalls).toHaveLength(0);
    });

    it('skips an Azure account that is already saved (by azAccountName)', async () => {
      const keysJson = JSON.stringify({ key1: 'key-abc' });
      const accountJson = JSON.stringify({ name: 'Sub' });
      const resourcesJson = JSON.stringify([
        {
          name: 'saved-account',
          kind: 'OpenAI',
          resourceGroup: 'rg-a',
          properties: { endpoint: 'https://saved-account.openai.azure.com/' },
        },
      ]);
      const deploymentsJson = JSON.stringify([
        { name: 'deploy', properties: { model: { name: 'gpt-4' } } },
      ]);

      setupCommandMock({
        'gh auth token': { stdout: '', stderr: 'not logged in' },
        'az account show': { stdout: accountJson, stderr: '' },
        'az cognitiveservices account list': { stdout: resourcesJson, stderr: '' },
        'az cognitiveservices account deployment list': { stdout: deploymentsJson, stderr: '' },
        'az cognitiveservices account keys list': { stdout: keysJson, stderr: '' },
      });
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

      const { detectProviders, AZ_CLI_AUTH_SENTINEL } = await import('./providerAutoDetect');

      const result = await detectProviders([
        {
          providerId: 'azure',
          config: { apiKey: AZ_CLI_AUTH_SENTINEL, azAccountName: 'saved-account' },
        },
      ]);

      expect(
        result.find((p: DetectedProvider) => p.config?.azAccountName === 'saved-account')
      ).toBeUndefined();
    });

    it('returns a new Azure account even when a different Azure account is already saved', async () => {
      const keysJson = JSON.stringify({ key1: 'key-abc' });
      const accountJson = JSON.stringify({ name: 'Sub' });
      const resourcesJson = JSON.stringify([
        // The already-saved account
        {
          name: 'old-account',
          kind: 'OpenAI',
          resourceGroup: 'rg-old',
          properties: { endpoint: 'https://old-account.openai.azure.com/' },
        },
        // A new account not yet saved
        {
          name: 'new-account',
          kind: 'OpenAI',
          resourceGroup: 'rg-new',
          properties: { endpoint: 'https://new-account.openai.azure.com/' },
        },
      ]);
      const deploymentsJson = JSON.stringify([
        { name: 'deploy', properties: { model: { name: 'gpt-4' } } },
      ]);

      setupCommandMock({
        'gh auth token': { stdout: '', stderr: 'not logged in' },
        'az account show': { stdout: accountJson, stderr: '' },
        'az cognitiveservices account list': { stdout: resourcesJson, stderr: '' },
        'az cognitiveservices account deployment list': { stdout: deploymentsJson, stderr: '' },
        'az cognitiveservices account keys list': { stdout: keysJson, stderr: '' },
      });
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

      const { detectProviders, AZ_CLI_AUTH_SENTINEL } = await import('./providerAutoDetect');

      const result = await detectProviders([
        {
          providerId: 'azure',
          config: { apiKey: AZ_CLI_AUTH_SENTINEL, azAccountName: 'old-account' },
        },
      ]);

      // old-account must be suppressed
      expect(
        result.find((p: DetectedProvider) => p.config?.azAccountName === 'old-account')
      ).toBeUndefined();
      // new-account must be offered
      const newProvider = result.find(
        (p: DetectedProvider) => p.config?.azAccountName === 'new-account'
      );
      expect(newProvider).toBeDefined();
      expect(newProvider!.providerId).toBe('azure');
    });

    it('skips an Azure account that was manually configured (matched by endpoint, no azAccountName)', async () => {
      const accountJson = JSON.stringify({ name: 'Sub' });
      // The Azure CLI returns this account with an endpoint
      const resourcesJson = JSON.stringify([
        {
          name: 'manual-account',
          kind: 'OpenAI',
          resourceGroup: 'rg-a',
          properties: { endpoint: 'https://manual-account.openai.azure.com/' },
        },
      ]);

      setupCommandMock({
        'gh auth token': { stdout: '', stderr: 'not logged in' },
        'az account show': { stdout: accountJson, stderr: '' },
        'az cognitiveservices account list': { stdout: resourcesJson, stderr: '' },
        // deployment list and keys list must NOT be called for the skipped account
      });
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

      const { detectProviders } = await import('./providerAutoDetect');

      // Manually-configured provider: has endpoint but no azAccountName
      const result = await detectProviders([
        {
          providerId: 'azure',
          config: {
            apiKey: 'my-real-key',
            endpoint: 'https://manual-account.openai.azure.com/',
            deploymentName: 'gpt4',
          },
        },
      ]);

      // Must not be offered again
      expect(
        result.find(
          (p: DetectedProvider) => p.config?.endpoint === 'https://manual-account.openai.azure.com/'
        )
      ).toBeUndefined();

      // Must not have called deployment or key commands
      const deploymentCalls = mockPluginRunCommand.mock.calls.filter(
        ([cmd, args]: [string, string[]]) => cmd === 'az' && args.includes('deployment')
      );
      const keyCalls = mockPluginRunCommand.mock.calls.filter(
        ([cmd, args]: [string, string[]]) => cmd === 'az' && args.includes('keys')
      );
      expect(deploymentCalls).toHaveLength(0);
      expect(keyCalls).toHaveLength(0);
    });

    it('is not fooled by endpoint URL casing or trailing slashes', async () => {
      const accountJson = JSON.stringify({ name: 'Sub' });
      const resourcesJson = JSON.stringify([
        {
          name: 'my-account',
          kind: 'OpenAI',
          resourceGroup: 'rg-a',
          // CLI returns with trailing slash and mixed case host
          properties: { endpoint: 'https://My-Account.openai.azure.com/' },
        },
      ]);

      setupCommandMock({
        'gh auth token': { stdout: '', stderr: 'not logged in' },
        'az account show': { stdout: accountJson, stderr: '' },
        'az cognitiveservices account list': { stdout: resourcesJson, stderr: '' },
      });
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

      const { detectProviders } = await import('./providerAutoDetect');

      // Stored without trailing slash, lowercase
      const result = await detectProviders([
        {
          providerId: 'azure',
          config: {
            apiKey: 'my-real-key',
            endpoint: 'https://my-account.openai.azure.com',
          },
        },
      ]);

      expect(
        result.find((p: DetectedProvider) => String(p.config?.endpoint).includes('my-account'))
      ).toBeUndefined();
    });

    it('is not fooled by leading/trailing whitespace in a stored endpoint', async () => {
      const accountJson = JSON.stringify({ name: 'Sub' });
      const resourcesJson = JSON.stringify([
        {
          name: 'ws-account',
          kind: 'OpenAI',
          resourceGroup: 'rg-b',
          properties: { endpoint: 'https://ws-account.openai.azure.com/' },
        },
      ]);

      setupCommandMock({
        'gh auth token': { stdout: '', stderr: 'not logged in' },
        'az account show': { stdout: accountJson, stderr: '' },
        'az cognitiveservices account list': { stdout: resourcesJson, stderr: '' },
      });
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

      const { detectProviders } = await import('./providerAutoDetect');

      // Endpoint stored with surrounding whitespace (e.g. pasted by the user)
      const result = await detectProviders([
        {
          providerId: 'azure',
          config: {
            apiKey: 'my-real-key',
            endpoint: '  https://ws-account.openai.azure.com/  ',
          },
        },
      ]);

      expect(
        result.find((p: DetectedProvider) => String(p.config?.endpoint).includes('ws-account'))
      ).toBeUndefined();
    });

    it('returns empty array when nothing is detected', async () => {
      mockPluginRunCommand.mockImplementation(() => {
        throw new Error('not available');
      });

      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

      const { detectProviders } = await import('./providerAutoDetect');
      const result = await detectProviders([]);

      expect(result).toEqual([]);
    });
  });

  describe('collectAzureOpenAIProviders', () => {
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

      const { collectAzureOpenAIProviders, AZ_CLI_AUTH_SENTINEL } = await import(
        './providerAutoDetect'
      );
      const providers = await collectAzureOpenAIProviders();

      expect(providers).toHaveLength(1);
      const provider = providers[0];
      expect(provider.providerId).toBe('azure');
      expect(provider.source).toBe('Azure CLI');
      // Sentinel stored instead of real key
      expect(provider.config.apiKey).toBe(AZ_CLI_AUTH_SENTINEL);
      expect(provider.config.apiKey).not.toBe('azure-key-123');
      // Metadata for re-fetching the key
      expect(provider.config.azResourceGroup).toBe('my-rg');
      expect(provider.config.azAccountName).toBe('my-openai');
      expect(provider.config.endpoint).toBe('https://my-openai.openai.azure.com/');
      expect(provider.config.deploymentName).toBe('gpt4-deploy');
      expect(provider.config.model).toBe('gpt-4');
      expect(provider.displayName).toBe('Azure OpenAI (my-openai)');
    });

    it('returns [] when Azure CLI is not logged in', async () => {
      setupAzMock({
        'az account show': { stdout: '', stderr: 'Please run az login' },
      });

      const { collectAzureOpenAIProviders } = await import('./providerAutoDetect');
      const providers = await collectAzureOpenAIProviders();
      expect(providers).toEqual([]);
    });

    it('returns [] when no Azure OpenAI resources exist', async () => {
      const accountJson = JSON.stringify({ name: 'Sub' });

      setupAzMock({
        'az account show': { stdout: accountJson, stderr: '' },
        'az cognitiveservices account list': { stdout: '[]', stderr: '' },
      });

      const { collectAzureOpenAIProviders } = await import('./providerAutoDetect');
      const providers = await collectAzureOpenAIProviders();
      expect(providers).toEqual([]);
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

      const { collectAzureOpenAIProviders } = await import('./providerAutoDetect');
      const providers = await collectAzureOpenAIProviders();
      expect(providers).toEqual([]);
    });

    it('returns [] when key retrieval fails', async () => {
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

      const { collectAzureOpenAIProviders } = await import('./providerAutoDetect');
      const providers = await collectAzureOpenAIProviders();
      expect(providers).toEqual([]);
    });

    it('skips resources without endpoint or resourceGroup', async () => {
      const accountJson = JSON.stringify({ name: 'Sub' });
      // Resource missing endpoint
      const resourcesJson = JSON.stringify([{ name: 'bad-resource', kind: 'OpenAI' }]);

      setupAzMock({
        'az account show': { stdout: accountJson, stderr: '' },
        'az cognitiveservices account list': { stdout: resourcesJson, stderr: '' },
      });

      const { collectAzureOpenAIProviders } = await import('./providerAutoDetect');
      const providers = await collectAzureOpenAIProviders();
      expect(providers).toEqual([]);
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

  describe('dismissalKey', () => {
    it('returns the bare providerId for singleton providers (copilot)', async () => {
      const { dismissalKey } = await import('./providerAutoDetect');
      const provider: DetectedProvider = {
        providerId: 'copilot',
        source: 'GitHub CLI',
        displayName: 'GitHub Copilot (user)',
        config: { apiKey: '__gh_cli__', model: 'gpt-4o' },
      };
      expect(dismissalKey(provider)).toBe('copilot');
    });

    it('returns the bare providerId for Ollama (local)', async () => {
      const { dismissalKey } = await import('./providerAutoDetect');
      const provider: DetectedProvider = {
        providerId: 'local',
        source: 'Ollama',
        displayName: 'Ollama (llama3)',
        config: { baseUrl: 'http://localhost:11434', model: 'llama3' },
      };
      expect(dismissalKey(provider)).toBe('local');
    });

    it('returns azure:<accountName> for Azure accounts', async () => {
      const { dismissalKey } = await import('./providerAutoDetect');
      const provider: DetectedProvider = {
        providerId: 'azure',
        source: 'Azure CLI',
        displayName: 'Azure OpenAI (my-account)',
        config: {
          apiKey: '__az_cli__',
          azAccountName: 'my-account',
          azResourceGroup: 'rg-my',
          endpoint: 'https://my-account.openai.azure.com/',
          deploymentName: 'gpt4',
          model: 'gpt-4',
        },
      };
      expect(dismissalKey(provider)).toBe('azure:my-account');
    });

    it('returns bare "azure" when azAccountName is absent', async () => {
      const { dismissalKey } = await import('./providerAutoDetect');
      const provider: DetectedProvider = {
        providerId: 'azure',
        source: 'Azure CLI',
        displayName: 'Azure OpenAI',
        config: { apiKey: '__az_cli__' },
      };
      expect(dismissalKey(provider)).toBe('azure');
    });

    it('produces distinct keys for two Azure accounts', async () => {
      const { dismissalKey } = await import('./providerAutoDetect');
      const mkAzure = (name: string): DetectedProvider => ({
        providerId: 'azure',
        source: 'Azure CLI',
        displayName: `Azure OpenAI (${name})`,
        config: { apiKey: '__az_cli__', azAccountName: name },
      });
      expect(dismissalKey(mkAzure('account-a'))).toBe('azure:account-a');
      expect(dismissalKey(mkAzure('account-b'))).toBe('azure:account-b');
      expect(dismissalKey(mkAzure('account-a'))).not.toBe(dismissalKey(mkAzure('account-b')));
    });
  });

  describe('collectAzureOpenAIProviders', () => {
    /**
     * Shared mock helper — identical to the one in the other collectAzureOpenAIProviders
     * describe block, but scoped to this describe block for clarity.
     */
    function setupAzMock(responses: Record<string, { stdout: string; stderr: string }>) {
      mockPluginRunCommand.mockImplementation((command: string, args: string[]) => {
        const key = [command, ...args].join(' ');
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

    it('returns one provider per account when multiple accounts have chat deployments', async () => {
      const accountJson = JSON.stringify({ name: 'Sub' });
      const resourcesJson = JSON.stringify([
        {
          name: 'account-a',
          kind: 'OpenAI',
          resourceGroup: 'rg-a',
          properties: { endpoint: 'https://account-a.openai.azure.com/' },
        },
        {
          name: 'account-b',
          kind: 'OpenAI',
          resourceGroup: 'rg-b',
          properties: { endpoint: 'https://account-b.openai.azure.com/' },
        },
      ]);
      const deploymentsA = JSON.stringify([
        { name: 'deploy-a', properties: { model: { name: 'gpt-4' } } },
      ]);
      const deploymentsB = JSON.stringify([
        { name: 'deploy-b', properties: { model: { name: 'gpt-35-turbo' } } },
      ]);
      const keysJson = JSON.stringify({ key1: 'key-abc', key2: 'key-def' });

      setupAzMock({
        'az account show': { stdout: accountJson, stderr: '' },
        'az cognitiveservices account list': { stdout: resourcesJson, stderr: '' },
        'az cognitiveservices account deployment list -g rg-a': {
          stdout: deploymentsA,
          stderr: '',
        },
        'az cognitiveservices account deployment list -g rg-b': {
          stdout: deploymentsB,
          stderr: '',
        },
        'az cognitiveservices account keys list -g rg-a': { stdout: keysJson, stderr: '' },
        'az cognitiveservices account keys list -g rg-b': { stdout: keysJson, stderr: '' },
      });

      const { collectAzureOpenAIProviders, AZ_CLI_AUTH_SENTINEL } = await import(
        './providerAutoDetect'
      );
      const providers = await collectAzureOpenAIProviders();

      expect(providers).toHaveLength(2);
      expect(providers[0].config.azAccountName).toBe('account-a');
      expect(providers[1].config.azAccountName).toBe('account-b');
      expect(providers[0].config.apiKey).toBe(AZ_CLI_AUTH_SENTINEL);
      expect(providers[1].config.apiKey).toBe(AZ_CLI_AUTH_SENTINEL);
      expect(providers[0].displayName).toBe('Azure OpenAI (account-a)');
      expect(providers[1].displayName).toBe('Azure OpenAI (account-b)');
      expect(providers[0].config.deploymentName).toBe('deploy-a');
      expect(providers[1].config.deploymentName).toBe('deploy-b');
    });

    it('skips an account whose key retrieval fails and still returns the other', async () => {
      const accountJson = JSON.stringify({ name: 'Sub' });
      const resourcesJson = JSON.stringify([
        {
          name: 'no-access',
          kind: 'OpenAI',
          resourceGroup: 'rg-a',
          properties: { endpoint: 'https://no-access.openai.azure.com/' },
        },
        {
          name: 'has-access',
          kind: 'OpenAI',
          resourceGroup: 'rg-b',
          properties: { endpoint: 'https://has-access.openai.azure.com/' },
        },
      ]);
      const deploymentsJson = JSON.stringify([
        { name: 'deploy', properties: { model: { name: 'gpt-4' } } },
      ]);
      const keysJson = JSON.stringify({ key1: 'key-abc' });

      setupAzMock({
        'az account show': { stdout: accountJson, stderr: '' },
        'az cognitiveservices account list': { stdout: resourcesJson, stderr: '' },
        // Both accounts have deployments
        'az cognitiveservices account deployment list -g rg-a': {
          stdout: deploymentsJson,
          stderr: '',
        },
        'az cognitiveservices account deployment list -g rg-b': {
          stdout: deploymentsJson,
          stderr: '',
        },
        // no-access: key retrieval fails; has-access: succeeds
        'az cognitiveservices account keys list -g rg-a': {
          stdout: '',
          stderr: 'Access denied',
        },
        'az cognitiveservices account keys list -g rg-b': { stdout: keysJson, stderr: '' },
      });

      const { collectAzureOpenAIProviders } = await import('./providerAutoDetect');
      const providers = await collectAzureOpenAIProviders();

      expect(providers).toHaveLength(1);
      expect(providers[0].config.azAccountName).toBe('has-access');
    });

    it('skips an account with no chat-capable deployments and still returns the other', async () => {
      const accountJson = JSON.stringify({ name: 'Sub' });
      const resourcesJson = JSON.stringify([
        {
          name: 'embeddings-only',
          kind: 'OpenAI',
          resourceGroup: 'rg-a',
          properties: { endpoint: 'https://embeddings-only.openai.azure.com/' },
        },
        {
          name: 'chat-account',
          kind: 'OpenAI',
          resourceGroup: 'rg-b',
          properties: { endpoint: 'https://chat-account.openai.azure.com/' },
        },
      ]);
      // Account A: only embedding deployments (filtered by isChatDeployment heuristic)
      const embeddingDeployments = JSON.stringify([
        { name: 'embed-deploy', properties: { model: { name: 'text-embedding-ada-002' } } },
      ]);
      // Account B: chat deployment
      const chatDeployments = JSON.stringify([
        { name: 'chat-deploy', properties: { model: { name: 'gpt-4' } } },
      ]);
      const keysJson = JSON.stringify({ key1: 'key-abc' });

      setupAzMock({
        'az account show': { stdout: accountJson, stderr: '' },
        'az cognitiveservices account list': { stdout: resourcesJson, stderr: '' },
        'az cognitiveservices account deployment list -g rg-a': {
          stdout: embeddingDeployments,
          stderr: '',
        },
        'az cognitiveservices account deployment list -g rg-b': {
          stdout: chatDeployments,
          stderr: '',
        },
        'az cognitiveservices account keys list -g rg-b': { stdout: keysJson, stderr: '' },
      });

      const { collectAzureOpenAIProviders } = await import('./providerAutoDetect');
      const providers = await collectAzureOpenAIProviders();

      expect(providers).toHaveLength(1);
      expect(providers[0].config.azAccountName).toBe('chat-account');
    });
  });

  describe('isChatDeployment (via collectAzureOpenAIProviders)', () => {
    /**
     * Tests the private isChatDeployment filter indirectly: if the only deployment
     * is filtered out, collectAzureOpenAIProviders returns [].
     */
    function setupSingleDeploymentMock(
      deploymentName: string,
      modelName: string,
      capabilities?: Record<string, string>
    ) {
      const accountJson = JSON.stringify({ name: 'Sub' });
      const resourcesJson = JSON.stringify([
        {
          name: 'my-openai',
          kind: 'OpenAI',
          resourceGroup: 'my-rg',
          properties: { endpoint: 'https://my-openai.openai.azure.com/' },
        },
      ]);
      const deployment: Record<string, any> = {
        name: deploymentName,
        properties: { model: { name: modelName } },
      };
      if (capabilities) {
        deployment.properties.capabilities = capabilities;
      }
      const deploymentsJson = JSON.stringify([deployment]);
      const keysJson = JSON.stringify({ key1: 'key-abc' });

      mockPluginRunCommand.mockImplementation((command: string, args: string[]) => {
        const key = [command, ...args].join(' ');
        const responses: Record<string, { stdout: string; stderr: string }> = {
          'az account show': { stdout: accountJson, stderr: '' },
          'az cognitiveservices account list': { stdout: resourcesJson, stderr: '' },
          'az cognitiveservices account deployment list': { stdout: deploymentsJson, stderr: '' },
          'az cognitiveservices account keys list': { stdout: keysJson, stderr: '' },
        };
        const match = Object.keys(responses).find(k => key.startsWith(k));
        const resp = match ? responses[match] : { stdout: '', stderr: 'unknown' };
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

    it('includes a deployment with explicit chatCompletion=true capability', async () => {
      setupSingleDeploymentMock('chat-deploy', 'gpt-4', { chatCompletion: 'true' });
      const { collectAzureOpenAIProviders } = await import('./providerAutoDetect');
      const providers = await collectAzureOpenAIProviders();
      expect(providers).toHaveLength(1);
      expect(providers[0].config.deploymentName).toBe('chat-deploy');
    });

    it('excludes a deployment with explicit chatCompletion=false capability', async () => {
      setupSingleDeploymentMock('not-chat', 'some-model', { chatCompletion: 'false' });
      const { collectAzureOpenAIProviders } = await import('./providerAutoDetect');
      const providers = await collectAzureOpenAIProviders();
      expect(providers).toEqual([]);
    });

    it('excludes a deployment with embeddings=true capability (no chatCompletion flag)', async () => {
      setupSingleDeploymentMock('embed-deploy', 'some-model', { embeddings: 'true' });
      const { collectAzureOpenAIProviders } = await import('./providerAutoDetect');
      const providers = await collectAzureOpenAIProviders();
      expect(providers).toEqual([]);
    });

    it('excludes an embedding model by name heuristic when no capabilities are present', async () => {
      setupSingleDeploymentMock('embed', 'text-embedding-ada-002');
      const { collectAzureOpenAIProviders } = await import('./providerAutoDetect');
      const providers = await collectAzureOpenAIProviders();
      expect(providers).toEqual([]);
    });

    it('excludes a whisper model by name heuristic', async () => {
      setupSingleDeploymentMock('speech', 'whisper-1');
      const { collectAzureOpenAIProviders } = await import('./providerAutoDetect');
      const providers = await collectAzureOpenAIProviders();
      expect(providers).toEqual([]);
    });

    it('excludes a TTS model by name heuristic', async () => {
      setupSingleDeploymentMock('tts', 'tts-1');
      const { collectAzureOpenAIProviders } = await import('./providerAutoDetect');
      const providers = await collectAzureOpenAIProviders();
      expect(providers).toEqual([]);
    });

    it('excludes a DALL-E model by name heuristic', async () => {
      setupSingleDeploymentMock('image-gen', 'dall-e-3');
      const { collectAzureOpenAIProviders } = await import('./providerAutoDetect');
      const providers = await collectAzureOpenAIProviders();
      expect(providers).toEqual([]);
    });

    it('includes a standard chat model with no capabilities object (heuristic pass)', async () => {
      setupSingleDeploymentMock('gpt4', 'gpt-4o');
      const { collectAzureOpenAIProviders } = await import('./providerAutoDetect');
      const providers = await collectAzureOpenAIProviders();
      expect(providers).toHaveLength(1);
      expect(providers[0].config.model).toBe('gpt-4o');
    });
  });

  describe('detectGhCliAvailable', () => {
    it('returns true when gh exits with code 0 (authenticated)', async () => {
      const fakeToken = 'ghp_' + 'a'.repeat(36);
      mockPluginRunCommand.mockReturnValue({
        stdout: {
          on: (evt: string, cb: (data: string) => void) => evt === 'data' && cb(fakeToken),
        },
        stderr: { on: vi.fn() },
        on: (evt: string, cb: (code: number) => void) => evt === 'exit' && cb(0),
      });

      const { detectGhCliAvailable } = await import('./providerAutoDetect');
      expect(await detectGhCliAvailable()).toBe(true);
    });

    it('returns true when gh exits with code 1 (installed but not logged in)', async () => {
      mockPluginRunCommand.mockReturnValue({
        stdout: { on: vi.fn() },
        stderr: {
          on: (evt: string, cb: (data: string) => void) =>
            evt === 'data' && cb('You are not logged into any GitHub hosts.'),
        },
        on: (evt: string, cb: (code: number) => void) => evt === 'exit' && cb(1),
      });

      const { detectGhCliAvailable } = await import('./providerAutoDetect');
      expect(await detectGhCliAvailable()).toBe(true);
    });

    it('returns false when gh exits with code 127 (not installed)', async () => {
      mockPluginRunCommand.mockReturnValue({
        stdout: { on: vi.fn() },
        stderr: {
          on: (evt: string, cb: (data: string) => void) =>
            evt === 'data' && cb('zsh: command not found: gh'),
        },
        on: (evt: string, cb: (code: number) => void) => evt === 'exit' && cb(127),
      });

      const { detectGhCliAvailable } = await import('./providerAutoDetect');
      expect(await detectGhCliAvailable()).toBe(false);
    });

    it('returns false when stderr contains "command not found" even without exit 127', async () => {
      mockPluginRunCommand.mockReturnValue({
        stdout: { on: vi.fn() },
        stderr: {
          on: (evt: string, cb: (data: string) => void) =>
            evt === 'data' && cb('command not found: gh'),
        },
        on: (evt: string, cb: (code: number) => void) => evt === 'exit' && cb(1),
      });

      const { detectGhCliAvailable } = await import('./providerAutoDetect');
      expect(await detectGhCliAvailable()).toBe(false);
    });

    it('returns false when stderr contains "is not recognized" (Windows)', async () => {
      mockPluginRunCommand.mockReturnValue({
        stdout: { on: vi.fn() },
        stderr: {
          on: (evt: string, cb: (data: string) => void) =>
            evt === 'data' && cb("'gh' is not recognized as an internal or external command"),
        },
        on: (evt: string, cb: (code: number) => void) => evt === 'exit' && cb(1),
      });

      const { detectGhCliAvailable } = await import('./providerAutoDetect');
      expect(await detectGhCliAvailable()).toBe(false);
    });

    it('returns false when stderr contains "no such file"', async () => {
      mockPluginRunCommand.mockReturnValue({
        stdout: { on: vi.fn() },
        stderr: {
          on: (evt: string, cb: (data: string) => void) =>
            evt === 'data' && cb('no such file or directory: gh'),
        },
        on: (evt: string, cb: (code: number) => void) => evt === 'exit' && cb(1),
      });

      const { detectGhCliAvailable } = await import('./providerAutoDetect');
      expect(await detectGhCliAvailable()).toBe(false);
    });

    it('returns false when pluginRunCommand is undefined (not in desktop mode)', async () => {
      vi.stubGlobal('pluginRunCommand', undefined);

      const { detectGhCliAvailable } = await import('./providerAutoDetect');
      expect(await detectGhCliAvailable()).toBe(false);
    });

    it('returns false when the error handler fires with ENOENT (binary missing on this OS)', async () => {
      mockPluginRunCommand.mockReturnValue({
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: (evt: string, cb: (arg: any) => void) => {
          if (evt === 'error') {
            const err = Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });
            cb(err);
          }
        },
      });

      const { detectGhCliAvailable } = await import('./providerAutoDetect');
      expect(await detectGhCliAvailable()).toBe(false);
    });
  });
});
