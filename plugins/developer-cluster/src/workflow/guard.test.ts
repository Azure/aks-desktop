// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCli } from '../cli/runner';
import { exclusive } from './guard';
import { getWorkflowState, update } from './store';

describe('exclusive', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('runs the next operation after a CLI command whose exit could not be observed', async () => {
    const attach = () => {
      throw new Error('detached');
    };
    vi.stubGlobal('pluginRunCommand', () => ({ stdout: { on: attach }, stderr: {}, on: attach }));
    update({ busy: false, refreshFailure: null });

    const refreshed = await exclusive(
      async () => {
        await runCli(['cluster', 'show']);
      },
      failure => ({ refreshFailure: failure })
    );

    expect(refreshed).toBe(false);
    expect(getWorkflowState().refreshFailure).toStrictEqual({ source: 'cli', code: 'exit' });
    expect(getWorkflowState().busy).toBe(false);
    await expect(
      exclusive(
        async () => undefined,
        () => ({})
      )
    ).resolves.toBe(true);
  });
});
