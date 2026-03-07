// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { describe, expect, it } from 'vitest';
import { createContainerConfig } from '../__fixtures__/pipelineConfig';
import { getProbeConfigs, renderProbeMarkdown, renderProbeYaml } from './probeHelpers';
import { escapeYamlValue } from './yamlUtils';

describe('escapeYamlValue', () => {
  it('should return basic strings unchanged', () => {
    expect(escapeYamlValue('hello world')).toBe('hello world');
    expect(escapeYamlValue('simple-string_123')).toBe('simple-string_123');
  });

  it('should escape backslashes', () => {
    expect(escapeYamlValue('path\\to\\file')).toBe('path\\\\to\\\\file');
  });

  it('should escape double quotes', () => {
    expect(escapeYamlValue('say "hello"')).toBe('say \\"hello\\"');
  });

  it('should escape newlines', () => {
    expect(escapeYamlValue('line1\nline2')).toBe('line1\\nline2');
  });

  it('should escape carriage returns', () => {
    expect(escapeYamlValue('line1\rline2')).toBe('line1\\rline2');
  });

  it('should escape tabs', () => {
    expect(escapeYamlValue('col1\tcol2')).toBe('col1\\tcol2');
  });

  it('should handle all special chars combined', () => {
    expect(escapeYamlValue('a\\b"c\nd\re\tf')).toBe('a\\\\b\\"c\\nd\\re\\tf');
  });

  it('should return empty string unchanged', () => {
    expect(escapeYamlValue('')).toBe('');
  });

  it('should handle string with only special characters', () => {
    expect(escapeYamlValue('\\"\n\r\t')).toBe('\\\\\\"\\n\\r\\t');
  });
});

describe('renderProbeMarkdown', () => {
  it('should render disabled probe', () => {
    const result = renderProbeMarkdown({
      name: 'Liveness',
      enabled: false,
      path: '/health',
      showConfigs: false,
      initialDelay: 10,
      period: 10,
      timeout: 1,
      failure: 3,
      success: 1,
    });
    expect(result).toBe('- Liveness Probe: disabled');
  });

  it('should render enabled probe without timing configs', () => {
    const result = renderProbeMarkdown({
      name: 'Readiness',
      enabled: true,
      path: '/ready',
      showConfigs: false,
      initialDelay: 5,
      period: 10,
      timeout: 1,
      failure: 3,
      success: 1,
    });
    expect(result).toBe('- Readiness Probe: enabled (path: /ready)');
  });

  it('should render enabled probe with timing configs', () => {
    const result = renderProbeMarkdown({
      name: 'Startup',
      enabled: true,
      path: '/',
      showConfigs: true,
      initialDelay: 0,
      period: 10,
      timeout: 1,
      failure: 30,
      success: 1,
    });
    expect(result).toBe(
      '- Startup Probe: enabled (path: /, initialDelay: 0s, period: 10s, timeout: 1s, failure: 30, success: 1)'
    );
  });
});

describe('renderProbeYaml', () => {
  it('should render disabled probe with minimal fields', () => {
    const lines = renderProbeYaml({
      name: 'Liveness',
      enabled: false,
      path: '/health',
      showConfigs: false,
      initialDelay: 10,
      period: 10,
      timeout: 1,
      failure: 3,
      success: 1,
    });
    expect(lines).toEqual(['livenessProbe:', '  enabled: false', '  path: "/health"']);
  });

  it('should render enabled probe without timing fields when showConfigs is false', () => {
    const lines = renderProbeYaml({
      name: 'Readiness',
      enabled: true,
      path: '/ready',
      showConfigs: false,
      initialDelay: 5,
      period: 10,
      timeout: 1,
      failure: 3,
      success: 1,
    });
    expect(lines).toEqual(['readinessProbe:', '  enabled: true', '  path: "/ready"']);
  });

  it('should render enabled probe with timing fields when showConfigs is true', () => {
    const lines = renderProbeYaml({
      name: 'Startup',
      enabled: true,
      path: '/',
      showConfigs: true,
      initialDelay: 0,
      period: 10,
      timeout: 1,
      failure: 30,
      success: 1,
    });
    expect(lines).toEqual([
      'startupProbe:',
      '  enabled: true',
      '  path: "/"',
      '  initialDelaySeconds: 0',
      '  periodSeconds: 10',
      '  timeoutSeconds: 1',
      '  failureThreshold: 30',
      '  successThreshold: 1',
    ]);
  });

  it('should escape special characters in path', () => {
    const lines = renderProbeYaml({
      name: 'Liveness',
      enabled: true,
      path: '/health\nmalicious',
      showConfigs: false,
      initialDelay: 10,
      period: 10,
      timeout: 1,
      failure: 3,
      success: 1,
    });
    expect(lines[2]).toBe('  path: "/health\\nmalicious"');
  });
});

describe('getProbeConfigs', () => {
  it('should extract three probe configs from ContainerConfig', () => {
    const cc = createContainerConfig();
    const [liveness, readiness, startup] = getProbeConfigs(cc);

    expect(liveness.name).toBe('Liveness');
    expect(liveness.enabled).toBe(true);
    expect(liveness.path).toBe('/health');
    expect(liveness.initialDelay).toBe(10);

    expect(readiness.name).toBe('Readiness');
    expect(readiness.enabled).toBe(true);
    expect(readiness.path).toBe('/ready');
    expect(readiness.initialDelay).toBe(5);

    expect(startup.name).toBe('Startup');
    expect(startup.enabled).toBe(true);
    expect(startup.path).toBe('/');
    expect(startup.initialDelay).toBe(0);
  });

  it('should reflect disabled probes', () => {
    const cc = createContainerConfig({
      enableLivenessProbe: false,
      enableReadinessProbe: false,
      enableStartupProbe: false,
    });
    const [liveness, readiness, startup] = getProbeConfigs(cc);

    expect(liveness.enabled).toBe(false);
    expect(readiness.enabled).toBe(false);
    expect(startup.enabled).toBe(false);
  });

  it('should pass showConfigs from container config', () => {
    const cc = createContainerConfig({ showProbeConfigs: true });
    const [liveness, readiness, startup] = getProbeConfigs(cc);

    expect(liveness.showConfigs).toBe(true);
    expect(readiness.showConfigs).toBe(true);
    expect(startup.showConfigs).toBe(true);
  });
});
