// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useCallback, useState } from 'react';

export interface DockerfileSelection {
  /** Full path in the repo, e.g. "src/web/Dockerfile" */
  path: string;
  /** Derived build context, e.g. "./src/web" */
  buildContext: string;
}

/**
 * Derives the build context directory from a Dockerfile path.
 * "Dockerfile" -> ".", "src/web/Dockerfile" -> "./src/web"
 */
export function deriveBuildContext(dockerfilePath: string): string {
  const parts = dockerfilePath.split('/');
  if (parts.length <= 1) return '.';
  return './' + parts.slice(0, -1).join('/');
}

export interface UseDockerfileDiscoveryReturn {
  /** All Dockerfile paths found in the repo. */
  dockerfilePaths: string[];
  /** The user's selected Dockerfile (null if not yet selected). */
  selection: DockerfileSelection | null;
  /** Select a Dockerfile by path. */
  select: (path: string) => void;
  /** Override the build context for the selected Dockerfile. */
  setBuildContext: (buildContext: string) => void;
}

/**
 * Manages Dockerfile selection state after discovery.
 * Auto-selects if exactly one Dockerfile is found.
 */
export function useDockerfileDiscovery(dockerfilePaths: string[]): UseDockerfileDiscoveryReturn {
  const [selection, setSelection] = useState<DockerfileSelection | null>(() => {
    if (dockerfilePaths.length === 1) {
      return {
        path: dockerfilePaths[0],
        buildContext: deriveBuildContext(dockerfilePaths[0]),
      };
    }
    return null;
  });

  const select = useCallback((path: string) => {
    setSelection({ path, buildContext: deriveBuildContext(path) });
  }, []);

  const setBuildContext = useCallback((buildContext: string) => {
    setSelection(prev => (prev ? { ...prev, buildContext } : null));
  }, []);

  return { dockerfilePaths, selection, select, setBuildContext };
}
