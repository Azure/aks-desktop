import { describe, expect, it } from 'vitest';
import {
  BASE_AKS_AGENT_PROMPT,
  buildEnrichedPrompt,
  shellEscapeSingleQuote,
} from './aksAgentManager';

describe('shellEscapeSingleQuote', () => {
  it('wraps simple strings in single quotes', () => {
    expect(shellEscapeSingleQuote('hello world')).toBe("'hello world'");
  });

  it('escapes single quotes', () => {
    expect(shellEscapeSingleQuote("it's")).toBe("'it'\\''s'");
  });

  it('handles empty string', () => {
    expect(shellEscapeSingleQuote('')).toBe("''");
  });

  it('prevents command substitution via $()', () => {
    const input = '$(rm -rf /)';
    const escaped = shellEscapeSingleQuote(input);
    // The $(…) is safely inside single quotes so bash won't interpret it
    expect(escaped).toBe("'$(rm -rf /)'");
    // The result must start and end with single quotes
    expect(escaped.startsWith("'")).toBe(true);
    expect(escaped.endsWith("'")).toBe(true);
  });

  it('prevents backtick command substitution', () => {
    const input = '`whoami`';
    const escaped = shellEscapeSingleQuote(input);
    expect(escaped).toBe("'`whoami`'");
  });

  it('prevents variable expansion', () => {
    const input = '$HOME/secret';
    const escaped = shellEscapeSingleQuote(input);
    expect(escaped).toBe("'$HOME/secret'");
  });

  it('handles double quotes without special treatment', () => {
    const input = 'say "hello"';
    const escaped = shellEscapeSingleQuote(input);
    expect(escaped).toBe('\'say "hello"\'');
  });

  it('handles multiple single quotes', () => {
    const input = "it's a 'test'";
    const escaped = shellEscapeSingleQuote(input);
    expect(escaped).toBe("'it'\\''s a '\\''test'\\'''");
  });

  it('handles newlines and special characters', () => {
    const input = 'line1\nline2\ttab';
    const escaped = shellEscapeSingleQuote(input);
    expect(escaped).toBe("'line1\nline2\ttab'");
  });
});

describe('buildEnrichedPrompt', () => {
  it('includes the base prompt and question', () => {
    const result = buildEnrichedPrompt('What pods are running?', []);
    expect(result).toContain(BASE_AKS_AGENT_PROMPT);
    expect(result).toContain('What pods are running?');
    expect(result).toContain('Now answer the following new question:');
  });

  it('does not include conversation history when empty', () => {
    const result = buildEnrichedPrompt('test?', []);
    expect(result).not.toContain('CONVERSATION HISTORY');
  });

  it('includes conversation history when provided', () => {
    const history = [
      { role: 'user' as const, content: 'Hello' },
      { role: 'assistant' as const, content: 'Hi there!' },
    ];
    const result = buildEnrichedPrompt('Follow up', history);
    expect(result).toContain('CONVERSATION HISTORY');
    expect(result).toContain('User: Hello');
    expect(result).toContain('Assistant: Hi there!');
    expect(result).toContain('Follow up');
  });

  it('contains code-formatting examples with Correct and Wrong labels', () => {
    expect(BASE_AKS_AGENT_PROMPT).toContain('✓ Correct');
    expect(BASE_AKS_AGENT_PROMPT).toContain('✗ Wrong');
  });

  it('covers major language tags in the code-formatting instruction', () => {
    for (const lang of ['yaml', 'json', 'bash', 'sh', 'python', 'dockerfile']) {
      expect(BASE_AKS_AGENT_PROMPT.toLowerCase()).toContain(lang);
    }
  });

  it('preserves conversation order', () => {
    const history = [
      { role: 'user' as const, content: 'First question' },
      { role: 'assistant' as const, content: 'First answer' },
      { role: 'user' as const, content: 'Second question' },
      { role: 'assistant' as const, content: 'Second answer' },
    ];
    const result = buildEnrichedPrompt('Third question', history);
    const firstIdx = result.indexOf('First question');
    const secondIdx = result.indexOf('Second question');
    const thirdIdx = result.indexOf('Third question');
    expect(firstIdx).toBeLessThan(secondIdx);
    expect(secondIdx).toBeLessThan(thirdIdx);
  });
});
