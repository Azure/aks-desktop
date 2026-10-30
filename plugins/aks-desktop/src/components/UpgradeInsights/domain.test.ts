// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { issueLabels } from '../../types/upgradeInsights';
import { cluster, passed } from './__fixtures__/fixtures';
import {
  csvCell,
  freshness,
  issuesFor,
  latestCombined,
  readiness,
  recordReadiness,
  safeDocumentationUrl,
  scopes,
} from './domain';

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-20T12:15:00Z'));
});

describe('known issue category translations', () => {
  it('translates every predefined label and leaves future categories unmapped', () => {
    const t = vi.fn((key: string) => `localized:${key}`);
    expect(issueLabels(t)).toEqual({
      PDBConstraint: 'localized:Disruption budgets',
      SubnetIPExhausted: 'localized:Subnet IP capacity',
      QuotaExceeded: 'localized:Compute quota',
      APIBreakingChange: 'localized:Removed APIs',
      ComponentVersionMismatch: 'localized:Component compatibility',
      UnsupportedKubernetesVersion: 'localized:Version support',
      NodeImageOutOfSLA: 'localized:Node image freshness',
    });
    expect(t).toHaveBeenCalledTimes(7);
    expect(issueLabels(t).FutureServerCategory).toBeUndefined();
  });
});

describe('conservative stored readiness', () => {
  it('marks a complete fresh combined result ready', () => {
    expect(readiness(passed(), cluster)).toBe('Ready');
  });
  it('does not interpret absent results as ready', () => {
    expect(readiness(undefined, cluster)).toBe('Not evaluated');
  });
  it('requires every expected pool', () => {
    const insight = passed();
    insight.properties.agentPools?.pop();
    expect(readiness(insight, cluster)).toBe('Not evaluated');
  });
  it('does not assume unknown pool inventory is complete', () => {
    expect(readiness(passed(), { ...cluster, poolInventoryKnown: false })).toBe('Not evaluated');
  });
  it('requires a control plane for combined results', () => {
    const insight = passed();
    delete insight.properties.controlPlane;
    expect(readiness(insight, cluster)).toBe('Not evaluated');
  });
  it('requires an evaluation object', () => {
    const insight = passed();
    delete insight.properties.controlPlane?.evaluation;
    expect(readiness(insight, cluster)).toBe('Not evaluated');
  });
  it.each(['Failed', 'Canceled'])('separates provisioning %s from readiness failure', state => {
    const insight = passed();
    insight.properties.provisioningState = state;
    expect(readiness(insight, cluster)).toBe('Unavailable');
  });
  it('does not call an in-progress compute ready', () => {
    const insight = passed();
    insight.properties.provisioningState = 'Updating';
    expect(readiness(insight, cluster)).toBe('Not evaluated');
  });
  it('marks expired evaluations for re-checking', () => {
    const insight = passed();
    insight.properties.expiresAt = '2026-10-20T10:00:00Z';
    expect(readiness(insight, cluster)).toBe('Re-check required');
  });
  it('uses client 24-hour freshness policy, not API retention', () => {
    const insight = passed();
    insight.properties.lastEvaluatedAt = '2026-10-18T12:00:00Z';
    expect(readiness(insight, cluster)).toBe('Re-check required');
  });
  it('detects an independently stale scope', () => {
    const insight = passed();
    insight.properties.controlPlane!.evaluation!.evaluatedAt = '2026-10-01T00:00:00Z';
    expect(readiness(insight, cluster)).toBe('Re-check required');
  });
  it('detects changed control-plane and pool source versions', () => {
    const insight = passed();
    insight.properties.agentPools![0].currentKubernetesVersion = '1.32.0';
    expect(freshness(insight, cluster)).toContain('version changed');
    insight.properties.controlPlane!.currentKubernetesVersion = '1.32.0';
    expect(readiness(insight, cluster)).not.toBe('Ready');
  });
  it('never treats a future extension as ready', () => {
    const insight = passed();
    insight.properties.upgradeType = 'FutureScope';
    expect(readiness(insight, cluster)).toBe('Unavailable');
  });
  it('does not claim readiness when source versions are unknown', () => {
    const insight = passed();
    delete insight.properties.controlPlane!.currentKubernetesVersion;
    expect(readiness(insight, cluster)).toBe('Re-check required');
  });
  it('requires a concrete evaluated target', () => {
    const insight = passed();
    delete insight.properties.targetKubernetesVersion;
    expect(readiness(insight, cluster)).toBe('Not evaluated');
  });
  it('does not hide an undated failure behind a dated ready snapshot', () => {
    const good = passed();
    const failed = passed();
    delete failed.properties.lastEvaluatedAt;
    failed.properties.provisioningState = 'Failed';
    expect(latestCombined({ cluster, insights: [good, failed] })).toBe(failed);
  });
  it('never treats unknown evaluation status as ready', () => {
    const insight = passed();
    insight.properties.controlPlane!.evaluation!.status = 'UnknownFutureState';
    expect(readiness(insight, cluster)).toBe('Unavailable');
  });
  it('treats unknown severity conservatively', () => {
    const insight = passed();
    insight.properties.controlPlane!.evaluation!.detectedIssues = [{ severity: 'NewSeverity' }];
    expect(readiness(insight, cluster)).toBe('Unavailable');
  });
  it('honors blockers even when the rollup says passed', () => {
    const insight = passed();
    insight.properties.controlPlane!.evaluation!.detectedIssues = [{ severity: 'Blocking' }];
    expect(readiness(insight, cluster)).toBe('Blocked');
  });
  it('preserves warning rollups without issue payloads', () => {
    const insight = passed();
    insight.properties.controlPlane!.evaluation!.status = 'Warning';
    expect(readiness(insight, cluster)).toBe('Review warnings');
  });
  it('shows transport errors as unavailable', () => {
    expect(recordReadiness({ cluster, insights: [passed()], error: 'Forbidden' })).toBe(
      'Unavailable'
    );
  });
  it('does not merge standalone and combined snapshots', () => {
    const combined = passed();
    const image = passed();
    image.properties.upgradeType = 'NodeImage';
    expect(latestCombined({ cluster, insights: [image, combined] })).toBe(combined);
  });
  it('flattens nested issues without double counting', () => {
    const insight = passed();
    insight.properties.agentPools![0].evaluation!.detectedIssues = [
      { severity: 'Blocking', issueType: 'PDBConstraint' },
    ];
    expect(scopes(insight)).toHaveLength(3);
    expect(issuesFor(insight)).toHaveLength(1);
    expect(issuesFor(insight)[0].scope).toBe('system');
  });
  it('requires independently comparable node-image versions', () => {
    const insight = passed();
    insight.properties = {
      ...insight.properties,
      upgradeType: 'NodeImage',
      agentPoolName: 'system',
      targetNodeImageVersion: 'image-new',
      currentNodeImageVersion: 'image-old',
      evaluation: { status: 'Passed', evaluatedAt: insight.properties.lastEvaluatedAt! },
    };
    expect(readiness(insight, cluster)).toBe('Ready');
    insight.properties.currentNodeImageVersion = 'image-different';
    expect(readiness(insight, cluster)).toBe('Re-check required');
    delete insight.properties.currentNodeImageVersion;
    expect(readiness(insight, cluster)).toBe('Re-check required');
  });
});

describe('safe presentation', () => {
  it.each([
    'javascript:alert(1)',
    'https://evil.example',
    'http://learn.microsoft.com/a',
    'not a URL',
    'https://user:password@aka.ms/foo',
    'https://learn.microsoft.com:8443/path',
  ])('rejects unsafe documentation link %s', link => {
    expect(safeDocumentationUrl(link)).toBeUndefined();
  });
  it('allows official HTTPS documentation links', () => {
    expect(safeDocumentationUrl('https://learn.microsoft.com/azure/aks')).toBe(
      'https://learn.microsoft.com/azure/aks'
    );
  });
  it('escapes CSV delimiters, quotes, and formula prefixes', () => {
    expect(csvCell('hello,"world"')).toBe('"hello,""world"""');
    expect(csvCell('=HYPERLINK("bad")')).toBe('"\'=HYPERLINK(""bad"")"');
    expect(csvCell('  =1+1')).toBe('"\'  =1+1"');
    expect(csvCell('\n=1+1')).toBe('"\'\n=1+1"');
  });
});
