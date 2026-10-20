// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { vi } from 'vitest';
import type { GitHubAuthState } from '../../../types/github';
import type { UseGitHubAuthResult } from '../hooks/useGitHubAuth';

export function createGitHubAuthFixture(
  overrides: Partial<GitHubAuthState> = {}
): UseGitHubAuthResult {
  return {
    authState: {
      isAuthenticated: false,
      isRestoring: false,
      isAuthorizingBrowser: false,
      token: null,
      refreshToken: null,
      expiresAt: null,
      username: null,
      error: null,
      deviceAuthorization: null,
      isDisconnecting: false,
      disconnectError: null,
      sessionVersion: 1,
      ...overrides,
    },
    octokit: null,
    startOAuth: vi.fn().mockResolvedValue(undefined),
    cancelOAuth: vi.fn(),
    abortOAuth: vi.fn(),
    reset: vi.fn().mockResolvedValue({ success: true }),
  };
}
