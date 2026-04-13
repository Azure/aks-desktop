// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
  /** The user's selected Dockerfile (null if not yet selected). */
  selection: DockerfileSelection | null;
  /** Select a Dockerfile by path. No-op if the path is not in dockerfilePaths. */
  setSelectedPath: (path: string) => void;
  /** Override the build context for the selected Dockerfile. No-op if nothing is selected. */
  setBuildContext: (buildContext: string) => void;
}

/**
 * Manages Dockerfile selection state after discovery.
 * Auto-selects if exactly one Dockerfile is found.
 *
 * Robust to reference-unstable `dockerfilePaths` arrays (e.g. `?? []` inline expressions):
 * selection is synced by comparing array contents, not object identity.
 *
 * @param dockerfilePaths - The list of discovered Dockerfile paths. Pass `null` or an empty
 *   array to indicate no Dockerfiles found / not yet fetched.
 */
export function useDockerfileDiscovery(
  dockerfilePaths: string[] | null
): UseDockerfileDiscoveryReturn {
  const [selection, setSelection] = useState<DockerfileSelection | null>(null);

  // Stable key derived from array contents — avoids infinite effect loops when
  // callers pass a new array reference on each render (e.g. `?? []`).
  const pathsKey = useMemo(
    () => (dockerfilePaths ? dockerfilePaths.join('\0') : ''),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dockerfilePaths ? dockerfilePaths.join('\0') : '']
  );
  const pathsRef = useRef<string[] | null>(dockerfilePaths);
  pathsRef.current = dockerfilePaths;

  // Sync selection when the set of available Dockerfiles changes.
  // Auto-selects when exactly one Dockerfile is found; clears stale selections.
  useEffect(() => {
    const paths = pathsRef.current;
    setSelection(prev => {
      if (prev && paths?.includes(prev.path)) return prev;
      if (paths?.length === 1) {
        return { path: paths[0], buildContext: deriveBuildContext(paths[0]) };
      }
      return null;
    });
    // pathsKey is the stable proxy for paths array contents
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathsKey]);

  const setSelectedPath = useCallback(
    (path: string) => {
      if (!pathsRef.current?.includes(path)) return;
      setSelection({ path, buildContext: deriveBuildContext(path) });
    },
    [] // stable: reads from ref, no closure over paths
  );

  const setBuildContext = useCallback((buildContext: string) => {
    setSelection(prev => (prev ? { ...prev, buildContext } : null));
  }, []);

  return { selection, setSelectedPath, setBuildContext };
}
