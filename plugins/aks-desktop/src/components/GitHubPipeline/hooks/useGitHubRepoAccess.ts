// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { Octokit } from '@octokit/rest';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GitHubRepo } from '../../../types/github';
import { getRepo } from '../../../utils/github/github-api';
import { isGitHubAccessDenied } from '../../../utils/github/github-errors';
import { isGitHubSessionCurrent } from '../../../utils/github/github-session';

interface Access {
  status: 'none' | 'checking' | 'granted' | 'denied';
  error: string | null;
  retry: () => void;
}

/** Read-only revalidation; never resets or replaces the saved pipeline/repository. */
export function useGitHubRepoAccess(
  octokit: Octokit | null,
  repo: GitHubRepo | null,
  sessionVersion: number
): Access {
  const owner = repo?.owner;
  const name = repo?.repo;
  const key = JSON.stringify([sessionVersion, owner, name]);
  const latestKey = useRef(key);
  latestKey.current = key;
  const verified = useRef<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const [state, setState] = useState<Omit<Access, 'retry'> & { key: string }>({
    key,
    status: 'checking',
    error: null,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: Explicit retry restarts the read without changing session/repository identity.
  useEffect(() => {
    if (
      !octokit ||
      !owner ||
      !name ||
      !isGitHubSessionCurrent(sessionVersion) ||
      verified.current === key
    )
      return;
    let active = true;
    const current = () =>
      active && latestKey.current === key && isGitHubSessionCurrent(sessionVersion);
    setState({ key, status: 'checking', error: null });
    void getRepo(octokit, owner, name)
      .then(() => {
        if (!current()) return;
        verified.current = key;
        setState({ key, status: 'granted', error: null });
      })
      .catch(error => {
        if (!current()) return;
        const denied = isGitHubAccessDenied(error);
        setState({
          key,
          status: denied ? 'denied' : 'checking',
          error: denied
            ? 'Repository access could not be verified. Reconnect with an authorized GitHub account.'
            : 'Repository access could not be checked. Try again.',
        });
      });
    return () => {
      active = false;
    };
  }, [octokit, owner, name, sessionVersion, key, attempt]);

  if (!octokit || !repo || !isGitHubSessionCurrent(sessionVersion))
    return { status: 'none', error: null, retry };
  if (verified.current === key) return { status: 'granted', error: null, retry };
  return state.key === key ? { ...state, retry } : { status: 'checking', error: null, retry };
}
