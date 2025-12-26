import { Icon } from '@iconify/react';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import Namespace from '@kinvolk/headlamp-plugin/lib/lib/k8s/namespace';
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material';
import React, { useEffect, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { deleteManagedNamespace } from '../../utils/azure/az-cli';

interface ProjectDefinition {
  id: string;
  namespaces: string[];
  clusters: string[];
}

interface ButtonStyle {
  variant?: 'text' | 'outlined' | 'contained';
  color?: 'inherit' | 'primary' | 'secondary' | 'success' | 'error' | 'info' | 'warning';
}

interface AKSProjectDeleteButtonProps {
  project: ProjectDefinition;
  buttonStyle?: ButtonStyle;
}

const AKSProjectDeleteButton: React.FC<AKSProjectDeleteButtonProps> = ({ project }) => {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteNamespaces, setDeleteNamespaces] = useState(false);
  const [nsIsEditable, setNsIsEditable] = useState(false);
  const [nsIsDeletable, setNsIsDeletable] = useState(false);
  const history = useHistory();

  // AKS projects have only one namespace
  const namespaceName = project.namespaces[0];
  const [namespace] = K8s.ResourceClasses.Namespace.useGet(namespaceName, undefined, {
    cluster: project.clusters[0],
  });

  // Check permissions for the single namespace
  useEffect(() => {
    if (namespace) {
      const checkPermissions = async () => {
        try {
          // @ts-ignore: need to check types and if the third arg is necessary for getAuthorization
          const updateAuth = await namespace.getAuthorization('update', {}, project.clusters[0]);
          // @ts-ignore: need to check types and if the third arg is necessary for getAuthorization
          const deleteAuth = await namespace.getAuthorization('delete', {}, project.clusters[0]);

          const editable = updateAuth?.status?.allowed ?? false;
          const deletable = deleteAuth?.status?.allowed ?? false;

          console.log(`Namespace permissions for ${namespaceName}:`, {
            namespace: namespaceName,
            update: updateAuth,
            delete: deleteAuth,
            editable,
            deletable,
          });

          setNsIsEditable(editable);
          setNsIsDeletable(deletable);
        } catch (error) {
          console.error(`Error checking permissions for ${namespaceName}:`, error);
          setNsIsEditable(false);
          setNsIsDeletable(false);
        }
      };
      checkPermissions();
    }
  }, [namespace, namespaceName, project.clusters]);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const namespacePromises = project.namespaces.map(
        nsName =>
          new Promise<Namespace | null>(resolve => {
            K8s.ResourceClasses.Namespace.apiGet(
              (ns: Namespace) => resolve(ns),
              nsName,
              undefined,
              () => resolve(null),
              { cluster: project.clusters[0] }
            )();
          })
      );

      const namespaces = (await Promise.all(namespacePromises)).filter(
        (ns): ns is Namespace => ns !== null
      );

      for (const ns of namespaces) {
        const labels = ns.metadata?.labels || {};
        const isAKSManaged = labels['headlamp.dev/project-managed-by'] === 'aks-desktop';
        const namespaceName = ns.metadata?.name || '';

        if (isAKSManaged) {
          // Delete ARM managed namespace
          const result = await deleteManagedNamespace({
            clusterName: project.clusters[0],
            resourceGroup: labels['aks-desktop/project-resource-group'],
            namespaceName,
            subscriptionId: labels['aks-desktop/project-subscription'],
          });

          if (!result.success) {
            throw new Error(result.error || 'Failed to delete managed namespace');
          }

          if (deleteNamespaces) {
            // Delete the Kubernetes namespace
            await K8s.ResourceClasses.Namespace.apiEndpoint.delete(
              namespaceName,
              // @ts-ignore todo: not sure about this error
              {},
              project.clusters[0]
            );
          } else {
            // Re-fetch namespace to get latest resourceVersion after ARM call modified it
            const freshNs = await new Promise<Namespace>((resolve, reject) => {
              K8s.ResourceClasses.Namespace.apiGet(
                (ns: Namespace) => resolve(ns),
                namespaceName,
                undefined,
                (err: any) => reject(err),
                { cluster: project.clusters[0] }
              )();
            });

            // Remove project labels from namespace
            const updatedData = { ...freshNs.jsonData };
            if (updatedData.metadata?.labels) {
              delete updatedData.metadata.labels['headlamp.dev/project-id'];
              delete updatedData.metadata.labels['headlamp.dev/project-managed-by'];
              delete updatedData.metadata.labels['aks-desktop/project-subscription'];
              delete updatedData.metadata.labels['aks-desktop/project-resource-group'];
            }
            await K8s.ResourceClasses.Namespace.apiEndpoint.put(
              updatedData,
              {},
              project.clusters[0]
            );
          }
        } else {
          // Regular namespace (not AKS managed)
          if (deleteNamespaces) {
            await ns.delete();
          } else {
            // Remove project labels
            const updatedData = { ...ns.jsonData };
            if (updatedData.metadata?.labels) {
              delete updatedData.metadata.labels['headlamp.dev/project-id'];
              delete updatedData.metadata.labels['headlamp.dev/project-managed-by'];
            }
            await K8s.ResourceClasses.Namespace.apiEndpoint.put(
              updatedData,
              {},
              project.clusters[0]
            );
          }
        }
      }

      history.push('/');
    } catch (error) {
      console.error('Error deleting project:', error);
      alert(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setDeleting(false);
      setOpen(false);
    }
  };

  // Only show button if user has both edit and delete permissions
  const canDelete = nsIsEditable && nsIsDeletable;

  if (!canDelete) {
    return null;
  }

  return (
    <>
      <Tooltip title="Delete project">
        <IconButton
          aria-label="Delete project"
          onClick={() => setOpen(true)}
          disabled={deleting}
          size="medium"
        >
          <Icon icon="mdi:delete" />
        </IconButton>
      </Tooltip>

      <Dialog
        open={open}
        onClose={() => !deleting && setOpen(false)}
        aria-labelledby="project-delete-dialog-title"
        aria-describedby="project-delete-dialog-description"
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle id="project-delete-dialog-title">Delete Project</DialogTitle>
        <DialogContent>
          <DialogContentText id="project-delete-dialog-description" component="div">
            <Typography variant="body1" paragraph>
              Are you sure you want to delete project "{project.id}"?
            </Typography>

            <Typography variant="body2" paragraph>
              By default, this will remove the Azure managed namespace and project labels from the
              following namespaces:
            </Typography>

            <ul>
              {project.namespaces.map(ns => (
                <li key={ns}>
                  <strong>{ns}</strong>
                </li>
              ))}
            </ul>

            <FormControlLabel
              control={
                <Checkbox
                  checked={deleteNamespaces}
                  onChange={e => setDeleteNamespaces(e.target.checked)}
                  name="deleteNamespaces"
                  color="primary"
                />
              }
              label={
                <Typography variant="body2">
                  Also delete the namespaces (this will remove all resources within them)
                </Typography>
              }
            />

            {deleteNamespaces && (
              <Typography variant="body2" color="error" sx={{ mt: 1, fontWeight: 'bold' }}>
                Warning: This action cannot be undone. All resources in these namespaces will be
                permanently deleted.
              </Typography>
            )}

            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Note: For AKS managed namespaces, Azure ARM management will be removed automatically.
            </Typography>
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} color="secondary" variant="contained">
            Cancel
          </Button>
          <Button
            onClick={handleDelete}
            color="primary"
            variant="contained"
            disabled={deleting}
            sx={{ minWidth: '200px' }}
          >
            {deleting
              ? 'Deleting...'
              : deleteNamespaces
              ? 'Delete Project & Namespaces'
              : 'Delete Project'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default AKSProjectDeleteButton;
