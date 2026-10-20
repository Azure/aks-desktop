// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { Octokit } from '@octokit/rest';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { DisconnectResult, GitHubAuthState } from '../../../types/github';
import {
  abortDeviceLogin,
  cancelDeviceLogin,
  disconnectGitHub,
  getGitHubSessionSnapshot,
  retainGitHubSession,
  startDeviceLogin,
  subscribeGitHubSession,
} from '../../../utils/github/github-session';

export interface UseGitHubAuthResult {
  authState: GitHubAuthState;
  octokit: Octokit | null;
  startOAuth: () => Promise<void>;
  cancelOAuth: () => void;
  abortOAuth: () => void;
  reset: () => Promise<DisconnectResult>;
}

/** Independent Headlamp trees subscribe to the same module-owned session. */
export function useGitHubAuth(): UseGitHubAuthResult {
  const owner = useRef(Symbol('github-auth-owner'));
  const snapshot = useSyncExternalStore(
    subscribeGitHubSession,
    getGitHubSessionSnapshot,
    getGitHubSessionSnapshot
  );
  useEffect(() => retainGitHubSession(owner.current), []);
  const startOAuth = useCallback(() => startDeviceLogin(owner.current), []);
  const cancelOAuth = useCallback(() => cancelDeviceLogin(owner.current), []);
  const abortOAuth = useCallback(() => abortDeviceLogin(owner.current), []);
  return { ...snapshot, startOAuth, cancelOAuth, abortOAuth, reset: disconnectGitHub };
}
