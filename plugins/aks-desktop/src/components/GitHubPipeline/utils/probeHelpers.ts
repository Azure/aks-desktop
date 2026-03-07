// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { ContainerConfig } from '../../DeployWizard/hooks/useContainerConfiguration';
import { escapeYamlValue } from './yamlUtils';

interface ProbeRenderConfig {
  name: string;
  enabled: boolean;
  path: string;
  showConfigs: boolean;
  initialDelay: number;
  period: number;
  timeout: number;
  failure: number;
  success: number;
}

/**
 * Renders a probe as a single Markdown bullet line for the agent config.
 * - Enabled:  `- {name} Probe: enabled (path: {path}, initialDelay: …)`
 * - Disabled: `- {name} Probe: disabled`
 */
export function renderProbeMarkdown(probe: ProbeRenderConfig): string {
  if (!probe.enabled) return `- ${probe.name} Probe: disabled`;
  const timings = probe.showConfigs
    ? `, initialDelay: ${probe.initialDelay}s, period: ${probe.period}s, timeout: ${probe.timeout}s, failure: ${probe.failure}, success: ${probe.success}`
    : '';
  return `- ${probe.name} Probe: enabled (path: ${probe.path}${timings})`;
}

/**
 * Renders a probe as a YAML block for the issue body.
 * Always includes `enabled` and `path`; timing fields appear only when
 * the probe is enabled and `showConfigs` is true.
 */
export function renderProbeYaml(probe: ProbeRenderConfig): string[] {
  const tag = probe.name.charAt(0).toLowerCase() + probe.name.slice(1) + 'Probe';
  const lines: string[] = [
    `${tag}:`,
    `  enabled: ${probe.enabled}`,
    `  path: "${escapeYamlValue(probe.path)}"`,
  ];
  if (probe.enabled && probe.showConfigs) {
    lines.push(
      `  initialDelaySeconds: ${probe.initialDelay}`,
      `  periodSeconds: ${probe.period}`,
      `  timeoutSeconds: ${probe.timeout}`,
      `  failureThreshold: ${probe.failure}`,
      `  successThreshold: ${probe.success}`
    );
  }
  return lines;
}

/**
 * Extracts the three standard probe configs (liveness, readiness, startup)
 * from a ContainerConfig.
 */
export function getProbeConfigs(
  cc: ContainerConfig
): [ProbeRenderConfig, ProbeRenderConfig, ProbeRenderConfig] {
  return [
    {
      name: 'Liveness',
      enabled: cc.enableLivenessProbe,
      path: cc.livenessPath,
      showConfigs: cc.showProbeConfigs,
      initialDelay: cc.livenessInitialDelay,
      period: cc.livenessPeriod,
      timeout: cc.livenessTimeout,
      failure: cc.livenessFailure,
      success: cc.livenessSuccess,
    },
    {
      name: 'Readiness',
      enabled: cc.enableReadinessProbe,
      path: cc.readinessPath,
      showConfigs: cc.showProbeConfigs,
      initialDelay: cc.readinessInitialDelay,
      period: cc.readinessPeriod,
      timeout: cc.readinessTimeout,
      failure: cc.readinessFailure,
      success: cc.readinessSuccess,
    },
    {
      name: 'Startup',
      enabled: cc.enableStartupProbe,
      path: cc.startupPath,
      showConfigs: cc.showProbeConfigs,
      initialDelay: cc.startupInitialDelay,
      period: cc.startupPeriod,
      timeout: cc.startupTimeout,
      failure: cc.startupFailure,
      success: cc.startupSuccess,
    },
  ];
}
