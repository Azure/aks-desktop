// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { WorkflowRunConclusion, WorkflowRunStatus } from '../../../types/github';

export const getWorkflowBadgeLabel = (
  status: WorkflowRunStatus | null,
  conclusion: WorkflowRunConclusion
): string => {
  if (status === 'completed') {
    if (conclusion === 'success') return 'Succeeded';
    if (conclusion === 'failure') return 'Failed';
    if (conclusion === 'cancelled') return 'Cancelled';
    if (conclusion === 'timed_out') return 'Timed Out';
    return 'Completed';
  }
  if (status === 'in_progress') return 'Running';
  if (status === 'queued' || status === 'waiting') return 'Queued';
  return 'Unknown';
};

export const getWorkflowBadgeColor = (
  status: WorkflowRunStatus | null,
  conclusion: WorkflowRunConclusion
): 'success' | 'error' | 'info' | 'warning' | 'default' => {
  if (status === 'completed') {
    if (conclusion === 'success') return 'success';
    if (conclusion === 'failure') return 'error';
    return 'warning';
  }
  if (status === 'in_progress') return 'info';
  return 'default';
};

export const getPodStatusColor = (
  status: string
): 'success' | 'error' | 'warning' | 'info' | 'default' => {
  if (status === 'Running') return 'success';
  if (status === 'Pending' || status === 'ContainerCreating') return 'info';
  if (status === 'CrashLoopBackOff' || status === 'Error' || status === 'Failed') return 'error';
  if (status === 'Terminating' || status === 'OOMKilled') return 'warning';
  return 'default';
};

export const getRunStatusIcon = (
  status: WorkflowRunStatus | null,
  conclusion: WorkflowRunConclusion
): { icon: string; color: string } => {
  if (status === 'completed') {
    switch (conclusion) {
      case 'success':
        return { icon: 'mdi:check-circle', color: 'success.main' };
      case 'failure':
        return { icon: 'mdi:close-circle', color: 'error.main' };
      case 'cancelled':
        return { icon: 'mdi:cancel', color: 'text.secondary' };
      default:
        return { icon: 'mdi:help-circle', color: 'text.secondary' };
    }
  }
  if (status === 'in_progress') {
    return { icon: 'mdi:progress-clock', color: 'info.main' };
  }
  if (status === 'queued' || status === 'waiting') {
    return { icon: 'mdi:clock-outline', color: 'warning.main' };
  }
  return { icon: 'mdi:help-circle', color: 'text.secondary' };
};

export const getRunStatusLabel = (
  status: WorkflowRunStatus | null,
  conclusion: WorkflowRunConclusion
): string => {
  if (status === 'completed') return conclusion ?? 'completed';
  return status ?? 'unknown';
};

export const getCheckIcon = (conclusion: string | null, status: string): string => {
  if (conclusion === 'success') return 'mdi:check-circle';
  if (conclusion === 'failure') return 'mdi:close-circle';
  if (conclusion === 'cancelled' || conclusion === 'skipped') return 'mdi:minus-circle';
  if (status === 'in_progress' || status === 'queued') return 'mdi:progress-clock';
  return 'mdi:help-circle-outline';
};

export const getCheckColor = (conclusion: string | null, status: string): string => {
  if (conclusion === 'success') return 'success.main';
  if (conclusion === 'failure') return 'error.main';
  if (status === 'in_progress' || status === 'queued') return 'info.main';
  return 'text.secondary';
};
