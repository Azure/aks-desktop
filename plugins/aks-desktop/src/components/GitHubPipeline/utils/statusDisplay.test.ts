// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { describe, expect, it } from 'vitest';
import {
  getCheckColor,
  getCheckIcon,
  getPodStatusColor,
  getWorkflowBadgeColor,
  getWorkflowBadgeLabel,
} from './statusDisplay';

describe('getWorkflowBadgeLabel', () => {
  it('returns "Succeeded" for completed/success', () => {
    expect(getWorkflowBadgeLabel('completed', 'success')).toBe('Succeeded');
  });

  it('returns "Failed" for completed/failure', () => {
    expect(getWorkflowBadgeLabel('completed', 'failure')).toBe('Failed');
  });

  it('returns "Cancelled" for completed/cancelled', () => {
    expect(getWorkflowBadgeLabel('completed', 'cancelled')).toBe('Cancelled');
  });

  it('returns "Timed Out" for completed/timed_out', () => {
    expect(getWorkflowBadgeLabel('completed', 'timed_out')).toBe('Timed Out');
  });

  it('returns "Completed" for completed with other conclusions', () => {
    expect(getWorkflowBadgeLabel('completed', 'neutral')).toBe('Completed');
    expect(getWorkflowBadgeLabel('completed', 'skipped')).toBe('Completed');
    expect(getWorkflowBadgeLabel('completed', 'action_required')).toBe('Completed');
    expect(getWorkflowBadgeLabel('completed', 'stale')).toBe('Completed');
  });

  it('returns "Running" for in_progress', () => {
    expect(getWorkflowBadgeLabel('in_progress', null)).toBe('Running');
  });

  it('returns "Queued" for queued', () => {
    expect(getWorkflowBadgeLabel('queued', null)).toBe('Queued');
  });

  it('returns "Queued" for waiting', () => {
    expect(getWorkflowBadgeLabel('waiting', null)).toBe('Queued');
  });

  it('returns "Unknown" for null status', () => {
    expect(getWorkflowBadgeLabel(null, null)).toBe('Unknown');
  });
});

describe('getWorkflowBadgeColor', () => {
  it('returns "success" for completed/success', () => {
    expect(getWorkflowBadgeColor('completed', 'success')).toBe('success');
  });

  it('returns "error" for completed/failure', () => {
    expect(getWorkflowBadgeColor('completed', 'failure')).toBe('error');
  });

  it('returns "warning" for completed with other conclusions', () => {
    expect(getWorkflowBadgeColor('completed', 'cancelled')).toBe('warning');
    expect(getWorkflowBadgeColor('completed', 'timed_out')).toBe('warning');
    expect(getWorkflowBadgeColor('completed', 'neutral')).toBe('warning');
  });

  it('returns "info" for in_progress', () => {
    expect(getWorkflowBadgeColor('in_progress', null)).toBe('info');
  });

  it('returns "default" for queued', () => {
    expect(getWorkflowBadgeColor('queued', null)).toBe('default');
  });

  it('returns "default" for null status', () => {
    expect(getWorkflowBadgeColor(null, null)).toBe('default');
  });
});

describe('getPodStatusColor', () => {
  it('returns "success" for Running', () => {
    expect(getPodStatusColor('Running')).toBe('success');
  });

  it('returns "info" for Pending', () => {
    expect(getPodStatusColor('Pending')).toBe('info');
  });

  it('returns "info" for ContainerCreating', () => {
    expect(getPodStatusColor('ContainerCreating')).toBe('info');
  });

  it('returns "error" for CrashLoopBackOff', () => {
    expect(getPodStatusColor('CrashLoopBackOff')).toBe('error');
  });

  it('returns "error" for Error', () => {
    expect(getPodStatusColor('Error')).toBe('error');
  });

  it('returns "error" for Failed', () => {
    expect(getPodStatusColor('Failed')).toBe('error');
  });

  it('returns "warning" for Terminating', () => {
    expect(getPodStatusColor('Terminating')).toBe('warning');
  });

  it('returns "warning" for OOMKilled', () => {
    expect(getPodStatusColor('OOMKilled')).toBe('warning');
  });

  it('returns "default" for Succeeded', () => {
    expect(getPodStatusColor('Succeeded')).toBe('default');
  });

  it('returns "default" for ImagePullBackOff', () => {
    expect(getPodStatusColor('ImagePullBackOff')).toBe('default');
  });

  it('returns "default" for unknown status', () => {
    expect(getPodStatusColor('unknown-status')).toBe('default');
  });
});

describe('getCheckIcon', () => {
  it('returns check-circle for success', () => {
    expect(getCheckIcon('success', 'completed')).toBe('mdi:check-circle');
  });

  it('returns close-circle for failure', () => {
    expect(getCheckIcon('failure', 'completed')).toBe('mdi:close-circle');
  });

  it('returns minus-circle for cancelled', () => {
    expect(getCheckIcon('cancelled', 'completed')).toBe('mdi:minus-circle');
  });

  it('returns minus-circle for skipped', () => {
    expect(getCheckIcon('skipped', 'completed')).toBe('mdi:minus-circle');
  });

  it('returns progress-clock for in_progress status', () => {
    expect(getCheckIcon(null, 'in_progress')).toBe('mdi:progress-clock');
  });

  it('returns progress-clock for queued status', () => {
    expect(getCheckIcon(null, 'queued')).toBe('mdi:progress-clock');
  });

  it('returns help-circle-outline for unknown', () => {
    expect(getCheckIcon(null, 'completed')).toBe('mdi:help-circle-outline');
    expect(getCheckIcon('neutral', 'completed')).toBe('mdi:help-circle-outline');
  });
});

describe('getCheckColor', () => {
  it('returns success.main for success', () => {
    expect(getCheckColor('success', 'completed')).toBe('success.main');
  });

  it('returns error.main for failure', () => {
    expect(getCheckColor('failure', 'completed')).toBe('error.main');
  });

  it('returns info.main for in_progress', () => {
    expect(getCheckColor(null, 'in_progress')).toBe('info.main');
  });

  it('returns info.main for queued', () => {
    expect(getCheckColor(null, 'queued')).toBe('info.main');
  });

  it('returns text.secondary for unknown', () => {
    expect(getCheckColor(null, 'completed')).toBe('text.secondary');
    expect(getCheckColor('cancelled', 'completed')).toBe('text.secondary');
  });
});
