// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom

import type { Octokit } from '@octokit/rest';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/github/github-api', () => ({
  findLinkedPullRequest: vi.fn(),
  getIssue: vi.fn(),
  listIssueComments: vi.fn(),
}));

import {
  findLinkedPullRequest,
  getIssue,
  listIssueComments,
} from '../../../utils/github/github-api';
import { useAgentPRDiscovery } from './useAgentPRDiscovery';

const fakeOctokit = {} as unknown as Octokit;
const ISSUE_NUMBER = 42;
const OWNER = 'test-owner';
const REPO = 'test-repo';
const ISSUE_URL = `https://github.com/${OWNER}/${REPO}/issues/${ISSUE_NUMBER}`;

describe('useAgentPRDiscovery — failure classification', () => {
  beforeEach(() => {
    vi.mocked(findLinkedPullRequest).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('classifies closed issue + token-limit comment as token-limit', async () => {
    vi.mocked(getIssue).mockResolvedValue({
      number: ISSUE_NUMBER,
      state: 'closed',
      url: ISSUE_URL,
    });
    vi.mocked(listIssueComments).mockResolvedValue([
      { body: 'Tool ran successfully', user: 'copilot' },
      {
        body: 'Run failed: prompt token count of 70921 exceeds the limit of 64000',
        user: 'copilot',
      },
    ]);

    const { result } = renderHook(() =>
      useAgentPRDiscovery(fakeOctokit, OWNER, REPO, true, ISSUE_NUMBER)
    );

    await waitFor(() => expect(result.current.issueClosed).toBe(true));
    expect(result.current.failureReason).toBe('token-limit');
    expect(result.current.prNumber).toBeNull();
    expect(listIssueComments).toHaveBeenCalledWith(fakeOctokit, OWNER, REPO, ISSUE_NUMBER);
  });

  it("returns 'unknown' when closed issue has no token-limit comment", async () => {
    vi.mocked(getIssue).mockResolvedValue({
      number: ISSUE_NUMBER,
      state: 'closed',
      url: ISSUE_URL,
    });
    vi.mocked(listIssueComments).mockResolvedValue([
      { body: 'agent finished without making changes', user: 'copilot' },
    ]);

    const { result } = renderHook(() =>
      useAgentPRDiscovery(fakeOctokit, OWNER, REPO, true, ISSUE_NUMBER)
    );

    await waitFor(() => expect(result.current.issueClosed).toBe(true));
    expect(result.current.failureReason).toBe('unknown');
  });

  it("returns 'unknown' when comment fetch throws (best-effort)", async () => {
    vi.mocked(getIssue).mockResolvedValue({
      number: ISSUE_NUMBER,
      state: 'closed',
      url: ISSUE_URL,
    });
    vi.mocked(listIssueComments).mockRejectedValue(new Error('GitHub API rate limit'));

    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result } = renderHook(() =>
      useAgentPRDiscovery(fakeOctokit, OWNER, REPO, true, ISSUE_NUMBER)
    );

    await waitFor(() => expect(result.current.issueClosed).toBe(true));
    expect(result.current.failureReason).toBe('unknown');
    expect(consoleWarn).toHaveBeenCalledWith(
      'Failed to fetch issue comments for failure classification:',
      expect.any(Error)
    );

    consoleWarn.mockRestore();
  });
});
