// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import React, { createContext, useContext } from 'react';
import type { UseGitHubAuthResult } from './hooks/useGitHubAuth';
import { useGitHubAuth } from './hooks/useGitHubAuth';

type GitHubAuthContextValue = UseGitHubAuthResult;

const GitHubAuthContext = createContext<GitHubAuthContextValue | null>(null);

export const GitHubAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const auth = useGitHubAuth();
  return <GitHubAuthContext.Provider value={auth}>{children}</GitHubAuthContext.Provider>;
};

export const useGitHubAuthContext = (): GitHubAuthContextValue => {
  const ctx = useContext(GitHubAuthContext);
  if (!ctx) throw new Error('useGitHubAuthContext must be used within GitHubAuthProvider');
  return ctx;
};
