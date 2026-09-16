// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { useEffect, useState } from 'react';
import type { ProjectDefinition } from '../AKSProjectDeleteButton';

/**
 * Checks if the current user can update and delete the project's namespace.
 *
 * @param project - The project to check permissions for.
 * @returns `isLoading` while resolving, `canDelete` when permissions are confirmed.
 */
export function useProjectPermissions(project: ProjectDefinition) {
  const [nsIsEditable, setNsIsEditable] = useState(false);
  const [nsIsDeletable, setNsIsDeletable] = useState(false);
  const [isCheckingPermissions, setIsCheckingPermissions] = useState(true);

  // AKS projects have only one namespace
  const namespaceName = project.namespaces[0];
  const [namespace, namespaceError] = K8s.ResourceClasses.Namespace.useGet(
    namespaceName,
    undefined,
    {
      cluster: project.clusters[0],
    }
  );

  // Check permissions for the single namespace
  useEffect(() => {
    let isMounted = true;

    if (namespaceError) {
      setIsCheckingPermissions(false);
      setNsIsEditable(false);
      setNsIsDeletable(false);
      return;
    }

    if (namespace) {
      const checkPermissions = async () => {
        setIsCheckingPermissions(true);
        try {
          const updateAuth = await namespace.getAuthorization('update');
          const deleteAuth = await namespace.getAuthorization('delete');

          if (!isMounted) return;

          const editable = updateAuth?.status?.allowed ?? false;
          const deletable = deleteAuth?.status?.allowed ?? false;

          console.debug(`Namespace permissions for ${namespaceName}:`, {
            namespace: namespaceName,
            update: updateAuth,
            delete: deleteAuth,
            editable,
            deletable,
          });

          setNsIsEditable(editable);
          setNsIsDeletable(deletable);
        } catch (error) {
          if (!isMounted) return;
          console.error(`Error checking permissions for ${namespaceName}:`, error);
          setNsIsEditable(false);
          setNsIsDeletable(false);
        } finally {
          if (isMounted) setIsCheckingPermissions(false);
        }
      };
      checkPermissions();
    }

    return () => {
      isMounted = false;
    };
  }, [namespace, namespaceError, namespaceName, project.clusters[0]]);

  const isLoading = (!namespace && !namespaceError) || isCheckingPermissions;
  const canDelete = nsIsEditable && nsIsDeletable;

  return { isLoading, canDelete };
}
