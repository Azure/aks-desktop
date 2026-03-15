import { describe, expect, it, vi } from 'vitest';

vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  Link: vi.fn(),
}));

vi.mock('@kinvolk/headlamp-plugin/lib/k8s', () => ({
  ResourceClasses: {},
}));

vi.mock('react-router-dom', () => ({
  Link: vi.fn(),
  useHistory: () => ({ push: vi.fn() }),
}));

vi.mock('react-markdown', () => ({
  default: vi.fn(),
}));

vi.mock('remark-gfm', () => ({
  default: vi.fn(),
}));

vi.mock('./components', () => ({
  LogsButton: vi.fn(),
  YamlDisplay: vi.fn(),
}));

vi.mock('./utils/promptLinkHelper', () => ({
  getHeadlampLink: vi.fn(),
}));

vi.mock('./utils/SampleYamlLibrary', () => ({
  parseKubernetesYAML: vi.fn(),
}));

import {
  convertJsonToYaml,
  isJsonKubernetesResource,
  parseJsonContent,
  parseLogsButtonData,
} from './ContentRenderer';

describe('parseLogsButtonData', () => {
  it('parses valid logs button JSON', () => {
    const content = 'LOGS_BUTTON:{"data":{"logs":"line1\\nline2"}}';
    const result = parseLogsButtonData(content, 0);
    expect(result.success).toBe(true);
    expect(result.data.data.logs).toBe('line1\nline2');
  });

  it('finds JSON after LOGS_BUTTON: prefix', () => {
    const content = 'Some text LOGS_BUTTON:{"data":{"logs":"test"}}';
    const result = parseLogsButtonData(content, content.indexOf('LOGS_BUTTON:'));
    expect(result.success).toBe(true);
  });

  it('handles nested JSON objects', () => {
    const content = 'LOGS_BUTTON:{"data":{"logs":"test","metadata":{"pod":"my-pod"}}}';
    const result = parseLogsButtonData(content, 0);
    expect(result.success).toBe(true);
    expect(result.data.data.metadata.pod).toBe('my-pod');
  });

  it('handles braces inside JSON string values', () => {
    const content = 'LOGS_BUTTON:{"data":{"logs":"error: {unexpected}"}}';
    const result = parseLogsButtonData(content, 0);
    expect(result.success).toBe(true);
    expect(result.data.data.logs).toBe('error: {unexpected}');
  });

  it('handles escaped quotes inside JSON strings', () => {
    const content = 'LOGS_BUTTON:{"data":{"logs":"say \\"hello\\""}}';
    const result = parseLogsButtonData(content, 0);
    expect(result.success).toBe(true);
    expect(result.data.data.logs).toBe('say "hello"');
  });

  it('handles backslashes in JSON strings', () => {
    const content = 'LOGS_BUTTON:{"data":{"logs":"path\\\\to\\\\file"}}';
    const result = parseLogsButtonData(content, 0);
    expect(result.success).toBe(true);
    expect(result.data.data.logs).toBe('path\\to\\file');
  });

  it('fails when no JSON object found', () => {
    const content = 'LOGS_BUTTON: no json here';
    const result = parseLogsButtonData(content, 0);
    expect(result.success).toBe(false);
    expect(result.error).toContain('No JSON object found');
  });

  it('fails when required fields are missing', () => {
    const content = 'LOGS_BUTTON:{"other":"field"}';
    const result = parseLogsButtonData(content, 0);
    expect(result.success).toBe(false);
    expect(result.error).toContain('missing required fields');
  });

  it('fails when data.logs is missing', () => {
    const content = 'LOGS_BUTTON:{"data":{"other":"field"}}';
    const result = parseLogsButtonData(content, 0);
    expect(result.success).toBe(false);
    expect(result.error).toContain('missing required fields');
  });

  it('handles JSON with extra text after it', () => {
    const content = 'LOGS_BUTTON:{"data":{"logs":"test"}} and some more text';
    const result = parseLogsButtonData(content, 0);
    expect(result.success).toBe(true);
    expect(result.data.data.logs).toBe('test');
  });

  it('handles complex nested structures with braces in strings', () => {
    const content =
      'LOGS_BUTTON:{"data":{"logs":"Error in container {nginx}: exit code {1}","pod":"test"}}';
    const result = parseLogsButtonData(content, 0);
    expect(result.success).toBe(true);
    expect(result.data.data.logs).toBe('Error in container {nginx}: exit code {1}');
  });
});

describe('parseJsonContent', () => {
  it('parses valid JSON', () => {
    const result = parseJsonContent('{"key": "value"}');
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ key: 'value' });
  });

  it('parses JSON arrays', () => {
    const result = parseJsonContent('[1, 2, 3]');
    expect(result.success).toBe(true);
    expect(result.data).toEqual([1, 2, 3]);
  });

  it('fails on invalid JSON', () => {
    const result = parseJsonContent('not json');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid JSON');
  });

  it('fails on empty string', () => {
    const result = parseJsonContent('');
    expect(result.success).toBe(false);
  });
});

describe('isJsonKubernetesResource', () => {
  it('identifies K8s resource JSON', () => {
    const json = JSON.stringify({
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name: 'test' },
    });
    expect(isJsonKubernetesResource(json)).toBe(true);
  });

  it('rejects JSON without apiVersion', () => {
    const json = JSON.stringify({
      kind: 'Pod',
      metadata: { name: 'test' },
    });
    expect(isJsonKubernetesResource(json)).toBe(false);
  });

  it('rejects JSON without kind', () => {
    const json = JSON.stringify({
      apiVersion: 'v1',
      metadata: { name: 'test' },
    });
    expect(isJsonKubernetesResource(json)).toBe(false);
  });

  it('rejects non-JSON strings', () => {
    expect(isJsonKubernetesResource('not json')).toBe(false);
  });

  it('rejects strings not starting with {', () => {
    expect(isJsonKubernetesResource('[1, 2, 3]')).toBe(false);
  });

  it('handles whitespace around JSON', () => {
    const json = '  {"apiVersion": "v1", "kind": "Pod", "metadata": {"name": "test"}}  ';
    expect(isJsonKubernetesResource(json)).toBe(true);
  });
});

describe('convertJsonToYaml', () => {
  it('converts K8s JSON to YAML', () => {
    const json = JSON.stringify({
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name: 'test' },
    });
    const result = convertJsonToYaml(json);
    expect(result).toContain('apiVersion: v1');
    expect(result).toContain('kind: Pod');
    expect(result).toContain('name: test');
  });

  it('returns original content for non-K8s JSON', () => {
    const json = '{"key": "value"}';
    expect(convertJsonToYaml(json)).toBe(json);
  });

  it('returns original content for non-JSON', () => {
    const text = 'not json content';
    expect(convertJsonToYaml(text)).toBe(text);
  });

  it('returns original content for JSON arrays', () => {
    const json = '[1, 2, 3]';
    expect(convertJsonToYaml(json)).toBe(json);
  });
});

describe('malformed AI output handling', () => {
  describe('parseLogsButtonData with malformed JSON', () => {
    it('handles truncated JSON (missing closing brace)', () => {
      const content = 'LOGS_BUTTON:{"data":{"logs":"test"';
      const result = parseLogsButtonData(content, 0);
      expect(result.success).toBe(false);
    });

    it('handles JSON with trailing comma', () => {
      const content = 'LOGS_BUTTON:{"data":{"logs":"test",}}';
      const result = parseLogsButtonData(content, 0);
      expect(result.success).toBe(false);
    });

    it('handles JSON with single quotes instead of double quotes', () => {
      const content = "LOGS_BUTTON:{'data':{'logs':'test'}}";
      const result = parseLogsButtonData(content, 0);
      expect(result.success).toBe(false);
    });

    it('handles empty JSON object', () => {
      const content = 'LOGS_BUTTON:{}';
      const result = parseLogsButtonData(content, 0);
      expect(result.success).toBe(false);
      expect(result.error).toContain('missing required fields');
    });

    it('fails on JSON with literal unescaped newlines in strings', () => {
      const content = 'LOGS_BUTTON:{"data":{"logs":"line1\nline2"}}';
      const result = parseLogsButtonData(content, 0);
      expect(result.success).toBe(false);
    });

    it('handles LOGS_BUTTON with no colon', () => {
      const content = 'LOGS_BUTTON {"data":{"logs":"test"}}';
      const result = parseLogsButtonData(content, 0);
      expect(result.success).toBe(true);
    });

    it('handles deeply nested JSON', () => {
      const content = 'LOGS_BUTTON:{"data":{"logs":"test","meta":{"a":{"b":{"c":{"d":"deep"}}}}}}';
      const result = parseLogsButtonData(content, 0);
      expect(result.success).toBe(true);
      expect(result.data.data.meta.a.b.c.d).toBe('deep');
    });

    it('handles JSON with unicode characters', () => {
      const content = 'LOGS_BUTTON:{"data":{"logs":"Error: 日本語テスト"}}';
      const result = parseLogsButtonData(content, 0);
      expect(result.success).toBe(true);
      expect(result.data.data.logs).toContain('日本語');
    });

    it('handles JSON with very long log content', () => {
      const longLogs = 'x'.repeat(50000);
      const content = `LOGS_BUTTON:{"data":{"logs":"${longLogs}"}}`;
      const result = parseLogsButtonData(content, 0);
      expect(result.success).toBe(true);
      expect(result.data.data.logs.length).toBe(50000);
    });

    it('handles JSON where data.logs is a number', () => {
      const content = 'LOGS_BUTTON:{"data":{"logs":123}}';
      const result = parseLogsButtonData(content, 0);
      expect(result.success).toBe(true);
    });

    it('handles JSON where data.logs is null', () => {
      const content = 'LOGS_BUTTON:{"data":{"logs":null}}';
      const result = parseLogsButtonData(content, 0);
      expect(result.success).toBe(false);
      expect(result.error).toContain('missing required fields');
    });

    it('handles multiple LOGS_BUTTON markers', () => {
      const content =
        'LOGS_BUTTON:{"data":{"logs":"first"}} and LOGS_BUTTON:{"data":{"logs":"second"}}';
      const result = parseLogsButtonData(content, 0);
      expect(result.success).toBe(true);
      expect(result.data.data.logs).toBe('first');
    });
  });

  describe('parseJsonContent with malformed JSON', () => {
    it('fails on truncated JSON object', () => {
      const result = parseJsonContent('{"key": "val');
      expect(result.success).toBe(false);
    });

    it('fails on JSON with trailing comma', () => {
      const result = parseJsonContent('{"key": "value",}');
      expect(result.success).toBe(false);
    });

    it('fails on JSON with single quotes', () => {
      const result = parseJsonContent("{'key': 'value'}");
      expect(result.success).toBe(false);
    });

    it('fails on JSON with unquoted keys', () => {
      const result = parseJsonContent('{key: "value"}');
      expect(result.success).toBe(false);
    });

    it('fails on JavaScript object notation', () => {
      const result = parseJsonContent('{ key: value, count: 42 }');
      expect(result.success).toBe(false);
    });

    it('parses JSON with extra whitespace', () => {
      const result = parseJsonContent('  {  "key"  :  "value"  }  ');
      expect(result.success).toBe(true);
      expect(result.data.key).toBe('value');
    });

    it('fails on concatenated JSON objects', () => {
      const result = parseJsonContent('{"a":1}{"b":2}');
      expect(result.success).toBe(false);
    });

    it('parses JSON with unicode escape sequences', () => {
      const result = parseJsonContent('{"name": "\\u0048ello"}');
      expect(result.success).toBe(true);
      expect(result.data.name).toBe('Hello');
    });

    it('fails on XML-like content', () => {
      const result = parseJsonContent('<apiVersion>v1</apiVersion>');
      expect(result.success).toBe(false);
    });

    it('fails on YAML content', () => {
      const result = parseJsonContent('apiVersion: v1\nkind: Pod');
      expect(result.success).toBe(false);
    });
  });

  describe('isJsonKubernetesResource with edge cases', () => {
    it('rejects JSON with apiVersion but empty kind', () => {
      expect(isJsonKubernetesResource('{"apiVersion":"v1","kind":""}')).toBe(false);
    });

    it('rejects JSON where apiVersion is a number', () => {
      expect(isJsonKubernetesResource('{"apiVersion":1,"kind":"Pod"}')).toBe(true);
    });

    it('rejects deeply nested K8s-like JSON', () => {
      const json = '{"wrapper":{"apiVersion":"v1","kind":"Pod"}}';
      expect(isJsonKubernetesResource(json)).toBe(false);
    });

    it('rejects JSON with null apiVersion', () => {
      expect(isJsonKubernetesResource('{"apiVersion":null,"kind":"Pod"}')).toBe(false);
    });

    it('handles JSON with extra fields alongside K8s fields', () => {
      const json = JSON.stringify({
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name: 'svc' },
        spec: { ports: [{ port: 80 }] },
        extra: 'data',
      });
      expect(isJsonKubernetesResource(json)).toBe(true);
    });
  });

  describe('convertJsonToYaml with edge cases', () => {
    it('returns original for truncated JSON', () => {
      const input = '{"apiVersion": "v1", "kind": "Po';
      expect(convertJsonToYaml(input)).toBe(input);
    });

    it('returns original for JSON with only apiVersion', () => {
      const json = '{"apiVersion": "v1"}';
      expect(convertJsonToYaml(json)).toBe(json);
    });

    it('converts JSON with nested arrays', () => {
      const json = JSON.stringify({
        apiVersion: 'v1',
        kind: 'Pod',
        spec: { containers: [{ name: 'nginx', ports: [{ containerPort: 80 }] }] },
      });
      const result = convertJsonToYaml(json);
      expect(result).toContain('apiVersion: v1');
      expect(result).toContain('containerPort: 80');
    });

    it('returns original for null JSON string', () => {
      expect(convertJsonToYaml('null')).toBe('null');
    });

    it('returns original for boolean JSON string', () => {
      expect(convertJsonToYaml('true')).toBe('true');
    });
  });
});
