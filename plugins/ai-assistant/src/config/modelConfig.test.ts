import { describe, expect, it } from 'vitest';
import {
  getDefaultConfig,
  getProviderById,
  getProviderFields,
  modelProviders,
} from './modelConfig';

describe('modelConfig', () => {
  describe('copilot provider', () => {
    it('is included in modelProviders', () => {
      const copilot = modelProviders.find(p => p.id === 'copilot');
      expect(copilot).toBeDefined();
      expect(copilot!.name).toBe('GitHub Copilot');
      expect(copilot!.icon).toBe('ai-providers:copilot');
    });

    it('can be retrieved by getProviderById', () => {
      const provider = getProviderById('copilot');
      expect(provider).toBeDefined();
      expect(provider!.id).toBe('copilot');
      expect(provider!.name).toBe('GitHub Copilot');
    });

    it('has required apiKey and model fields', () => {
      const fields = getProviderFields('copilot');
      expect(fields).toHaveLength(2);

      const apiKeyField = fields.find(f => f.name === 'apiKey');
      expect(apiKeyField).toBeDefined();
      expect(apiKeyField!.required).toBe(true);
      expect(apiKeyField!.type).toBe('text');

      const modelField = fields.find(f => f.name === 'model');
      expect(modelField).toBeDefined();
      expect(modelField!.required).toBe(true);
      expect(modelField!.type).toBe('select');
      expect(modelField!.options).toContain('gpt-5.4');
      expect(modelField!.options).toContain('gpt-4o');
    });

    it('returns correct default config', () => {
      const config = getDefaultConfig('copilot');
      expect(config).toEqual({ model: 'gpt-5.4' });
    });
  });
});
