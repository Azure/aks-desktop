/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Icon } from '@iconify/react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { uniq } from 'lodash';
import { ReactNode, useCallback, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useHistory } from 'react-router';
import { useClustersConf } from '../../lib/k8s';
import { apply } from '../../lib/k8s/api/v1/apply';
import { ApiError } from '../../lib/k8s/api/v2/ApiError';
import { KubeObjectInterface } from '../../lib/k8s/KubeObject';
import Namespace from '../../lib/k8s/namespace';
import { useTypedSelector } from '../../redux/hooks';
import { CustomCreateProject } from '../../redux/projectsSlice';
import { PROJECT_ID_LABEL, toKubernetesName } from './projectUtils';

/**
 * Well-known IDs for built-in project creation options.
 * Plugins can override these by registering a customCreateProject with the same ID.
 */
export const BUILTIN_USE_EXISTING_NAMESPACE_ID = 'use-existing-namespace';
export const BUILTIN_CREATE_NAMESPACE_ID = 'create-namespace';

/**
 * A styled button for selecting a project type.
 */
function ProjectTypeButton({
  icon,
  title,
  description,
  index,
  onClick,
}: {
  index: number;
  icon: ReactNode;
  title: ReactNode;
  description: ReactNode;
  onClick?: any;
}) {
  return (
    <Button
      onClick={onClick}
      sx={{
        display: 'flex',
        justifyContent: 'flex-start',
        gap: 2,
        textAlign: 'start',
        border: '1px solid',
        borderColor: 'divider',
        alignItems: 'flex-start',
        padding: 3,
        py: 2,
        animationName: 'reveal',
        animationDuration: '0.25s',
        animationFillMode: 'both',
        animationDelay: 0.1 + index * 0.05 + 's',
        flex: '1',
        '@keyframes reveal': {
          from: {
            opacity: 0,
            transform: 'translateY(10px)',
          },
          to: {
            opacity: 1,
            transform: 'translateY(0)',
          },
        },
      }}
    >
      <Box sx={{ width: '52px', height: '52px', alignSelf: 'center' }}>{icon}</Box>
      <Box>
        <Typography variant="h6" component="span" sx={{ display: 'flex' }}>
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {description}
        </Typography>
      </Box>
    </Button>
  );
}

/**
 * Built-in dialog for creating or selecting a namespace as a project.
 * Used for both "Use Existing Namespace(s)" and "Create New Namespace".
 */
function NamespaceProjectDialog({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const history = useHistory();

  const [projectName, setProjectName] = useState('');
  const [selectedClusters, setSelectedClusters] = useState<string[]>([]);
  const [selectedNamespace, setSelectedNamespace] = useState<string>();
  const [typedNamespace, setTypedNamespace] = useState('');

  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<ApiError>();

  const clusters = Object.values(useClustersConf() ?? {});
  const { items: namespaces } = Namespace.useList({
    clusters: selectedClusters,
  });

  const existingProjectNames = useMemo(() => {
    if (!namespaces) return new Set<string>();
    const result = new Set<string>();
    for (const ns of namespaces) {
      const labelValue = ns.metadata.labels?.[PROJECT_ID_LABEL];
      if (!labelValue) {
        continue;
      }
      result.add(labelValue);
      result.add(toKubernetesName(labelValue));
    }
    return result;
  }, [namespaces]);

  // Check if project name already exists (using normalized form to match existing entries)
  const projectNameExists =
    projectName.length > 0 && existingProjectNames.has(toKubernetesName(projectName));

  const isReadyToCreate =
    selectedClusters.length &&
    (selectedNamespace || typedNamespace) &&
    projectName &&
    !projectNameExists;

  /**
   * Creates or updates namespaces for the project
   */
  const handleCreate = async () => {
    if (!isReadyToCreate || isCreating) return;

    setIsCreating(true);
    try {
      const existingNamespaces = namespaces?.filter(it => it.metadata.name === selectedNamespace);
      const clustersWithExistingNamespace = existingNamespaces?.map(it => it.cluster) ?? [];
      if (existingNamespaces && existingNamespaces.length > 0) {
        // Update all existing namespaces with the same name across selected clusters
        await Promise.all(
          existingNamespaces.map(namespace =>
            namespace.patch({
              metadata: {
                labels: {
                  [PROJECT_ID_LABEL]: projectName,
                },
              },
            })
          )
        );
      }

      // Create new namespace in all selected clusters that don't already have it
      const clustersWithoutNamespace = selectedClusters.filter(
        it => !clustersWithExistingNamespace.includes(it)
      );
      for (const cluster of clustersWithoutNamespace) {
        const namespace = {
          kind: 'Namespace',
          apiVersion: 'v1',
          metadata: {
            name: toKubernetesName(typedNamespace),
            labels: {
              [PROJECT_ID_LABEL]: projectName,
            },
          } as any,
        } as KubeObjectInterface;
        await apply(namespace, cluster);
      }

      history.push('/projects');
    } catch (e: any) {
      setError(e);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <>
      <DialogTitle sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        <Icon icon="mdi:folder-add" />
        {t('Create Project')}
      </DialogTitle>
      <DialogContent
        sx={{
          p: 3,
          minWidth: '25rem',
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
          minHeight: '20rem',
        }}
      >
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: '25rem' }}>
          <Trans>
            To create a new project pick which clusters you want to include and then select existing
            or create a new namespace
          </Trans>
        </Typography>
        <TextField
          label={t('translation|Project Name')}
          value={projectName}
          onChange={event => {
            const inputValue = event.target.value.toLowerCase();
            setProjectName(inputValue);
          }}
          onBlur={event => {
            const converted = toKubernetesName(event.target.value);
            setProjectName(converted);
          }}
          onKeyDown={event => {
            if (event.key === ' ') {
              event.preventDefault();
              const target = event.target as HTMLInputElement;
              const start = target.selectionStart || 0;
              const end = target.selectionEnd || 0;
              const currentValue = projectName;
              const newValue = currentValue.substring(0, start) + '-' + currentValue.substring(end);
              setProjectName(newValue);
              setTimeout(() => {
                target.setSelectionRange(start + 1, start + 1);
              }, 0);
            }
          }}
          error={projectNameExists}
          helperText={
            projectNameExists
              ? t('A project with this name already exists')
              : t('translation|Enter a name for your new project.')
          }
          autoComplete="off"
          fullWidth
        />
        <Autocomplete
          fullWidth
          multiple
          options={clusters.map(it => it.name)}
          value={selectedClusters}
          onChange={(e, newValue) => {
            setSelectedClusters(newValue);
          }}
          renderInput={params => (
            <TextField
              {...params}
              label={t('Clusters')}
              variant="outlined"
              size="small"
              helperText={t('Select one or more clusters for this project')}
            />
          )}
          noOptionsText={t('No available clusters')}
          disabled={clusters.length === 0}
        />
        <Autocomplete
          fullWidth
          freeSolo
          options={uniq(namespaces?.map(it => it.metadata.name)) ?? []}
          value={selectedNamespace}
          onChange={(event, newValue) => {
            setSelectedNamespace(newValue ?? undefined);
          }}
          onInputChange={(e, v) => {
            setTypedNamespace(v);
          }}
          renderInput={params => (
            <TextField
              {...params}
              label={t('Namespace')}
              placeholder={t('Type or select a namespace')}
              helperText={t('Select existing or type to create a new namespace')}
              variant="outlined"
              size="small"
            />
          )}
          noOptionsText={t('No available namespaces - you can type a custom name')}
        />
        {error && (
          <Alert severity="error" sx={{ maxWidth: '25rem' }}>
            {error?.message}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button variant="contained" color="secondary" onClick={onBack}>
          <Trans>Cancel</Trans>
        </Button>
        <Button
          variant="contained"
          onClick={handleCreate}
          disabled={isCreating || !isReadyToCreate}
        >
          {isCreating ? <Trans>Creating</Trans> : <Trans>Create</Trans>}
        </Button>
      </DialogActions>
    </>
  );
}

/**
 * Returns the merged list of project creation options.
 * Built-in defaults are included unless a plugin has registered an override with the same ID.
 */
function useCreateProjectOptions(): CustomCreateProject[] {
  const { t } = useTranslation();
  const pluginOptions = useTypedSelector(state => state.projects.customCreateProject);

  return useMemo(() => {
    const builtinDefaults: CustomCreateProject[] = [
      {
        id: BUILTIN_USE_EXISTING_NAMESPACE_ID,
        name: t('Use Existing Namespace(s)'),
        description: t('Select namespaces to use as a project'),
        icon: 'mdi:folder-open-outline',
        component: NamespaceProjectDialog,
      },
      {
        id: BUILTIN_CREATE_NAMESPACE_ID,
        name: t('Create New Namespace'),
        description: t('New namespace with resources as a project'),
        icon: 'mdi:folder-add',
        component: NamespaceProjectDialog,
      },
    ];

    // Merge: plugin registrations override built-ins with the same ID
    const merged = new Map<string, CustomCreateProject>();
    for (const builtin of builtinDefaults) {
      merged.set(builtin.id, builtin);
    }
    for (const plugin of Object.values(pluginOptions)) {
      merged.set(plugin.id, plugin);
    }

    return Array.from(merged.values());
  }, [pluginOptions, t]);
}

/**
 * A dialog for creating a new project.
 * Shows built-in options (Use Existing Namespace, Create New Namespace) plus any
 * custom options registered by plugins. Plugins can override built-in options by
 * registering with the same well-known ID.
 */
export function NewProjectPopup({ open, onClose }: { open: boolean; onClose: () => void }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const createProjectOptions = useCreateProjectOptions();

  const [projectStep, setProjectStep] = useState<string | undefined>();
  const selectedOption = createProjectOptions.find(it => it.id === projectStep);

  const handleBack = useCallback(() => {
    setProjectStep(undefined);
  }, []);

  // Keep track of buttons
  let index = 0;

  return (
    <Dialog open={open} maxWidth={false} onClose={onClose}>
      {projectStep === undefined && (
        <>
          <DialogTitle component="h1" sx={{ display: 'flex' }}>
            {t('Create a Project')}
          </DialogTitle>
          <DialogContent sx={{ maxWidth: '540px' }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              <Trans>
                A project groups one or more namespaces across your clusters, making it easy to view
                and manage related resources in one place.
              </Trans>
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {createProjectOptions.map(it => (
                <ProjectTypeButton
                  key={it.id}
                  index={index++}
                  icon={
                    typeof it.icon === 'string' ? (
                      <Icon
                        icon={it.icon}
                        width="100%"
                        height="100%"
                        color={theme.palette.text.secondary}
                      />
                    ) : (
                      <it.icon />
                    )
                  }
                  title={it.name}
                  description={it.description}
                  onClick={() => setProjectStep(it.id)}
                />
              ))}
            </Box>
          </DialogContent>
          <DialogActions>
            <Button variant="contained" color="secondary" onClick={onClose}>
              {t('Cancel')}
            </Button>
          </DialogActions>
        </>
      )}
      {selectedOption && <selectedOption.component onBack={handleBack} />}
    </Dialog>
  );
}
