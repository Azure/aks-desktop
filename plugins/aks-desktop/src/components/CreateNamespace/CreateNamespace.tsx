// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { K8s, useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { PageGrid, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  FormControl,
  TextField,
  Theme,
  Typography,
} from '@mui/material';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { createNamespaceAsProject } from '../../utils/kubernetes/namespaceUtils';
import { getClusterSettings, setClusterSettings } from '../../utils/shared/clusterSettings';
import { Breadcrumb } from '../CreateAKSProject/components/Breadcrumb';
import {
  SearchableSelect,
  SearchableSelectOption,
} from '../CreateAKSProject/components/SearchableSelect';
import { FormField } from '../shared/FormField';

const STEPS = ['Basics', 'Review'] as const;

type NamespaceStepName = (typeof STEPS)[number];

function getStepLabel(t: (key: string) => string, step: NamespaceStepName): string {
  switch (step) {
    case 'Basics':
      return t('Basics');
    case 'Review':
      return t('Review');
    default: {
      const _exhaustive: never = step;
      return String(_exhaustive);
    }
  }
}

const NAMESPACE_NAME_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

function CreateNamespaceContent() {
  const history = useHistory();
  const { t } = useTranslation();
  const clustersConf = K8s.useClustersConf();

  const [activeStep, setActiveStep] = useState(0);
  const [namespaceName, setNamespaceName] = useState('');
  const [selectedCluster, setSelectedCluster] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [creationProgress, setCreationProgress] = useState('');
  const [creationError, setCreationError] = useState<string | null>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [applicationName, setApplicationName] = useState('');
  const stepContentRef = useRef<HTMLDivElement>(null);

  // Focus the first form input when the active step changes.
  // Skip if the user already has focus inside the step content.
  useEffect(() => {
    const frameId = requestAnimationFrame(() => {
      const container = stepContentRef.current;
      if (!container) return;
      const active = document.activeElement as HTMLElement | null;
      if (active && container.contains(active)) return;
      const focusable =
        container.querySelector<HTMLElement>(
          'input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
        ) ??
        container.querySelector<HTMLElement>(
          'button:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])'
        );
      focusable?.focus();
    });
    return () => cancelAnimationFrame(frameId);
  }, [activeStep]);

  const clusterOptions: SearchableSelectOption[] = useMemo(() => {
    if (!clustersConf) return [];
    return Object.keys(clustersConf)
      .sort()
      .map(name => ({
        value: name,
        label: name,
      }));
  }, [clustersConf]);

  const validation = useMemo(() => {
    const errors: string[] = [];
    if (!selectedCluster) {
      errors.push(t('A cluster must be selected'));
    }
    if (!namespaceName) {
      errors.push(t('Namespace name is required'));
    } else if (!NAMESPACE_NAME_REGEX.test(namespaceName)) {
      errors.push(
        t(
          'Namespace name must contain only lowercase letters, numbers, and hyphens, and must start and end with an alphanumeric character'
        )
      );
    } else if (namespaceName.length > 63) {
      errors.push(t('Namespace name must be 63 characters or fewer'));
    }
    return { isValid: errors.length === 0, errors };
  }, [selectedCluster, namespaceName]);

  const handleSubmit = async () => {
    try {
      setIsCreating(true);
      setCreationError(null);
      setCreationProgress(`${t('Creating namespace')}...`);

      await createNamespaceAsProject(namespaceName, selectedCluster);

      setCreationProgress(`${t('Updating local settings')}...`);
      // Only append to allowedNamespaces if it's already configured. Appending
      // from scratch can potentially hide pre-existing projects a user can see.
      const settings = getClusterSettings(selectedCluster);
      const existing = settings.allowedNamespaces;
      if (Array.isArray(existing) && existing.length > 0 && !existing.includes(namespaceName)) {
        settings.allowedNamespaces = [...existing, namespaceName];
        setClusterSettings(selectedCluster, settings);
      }

      setCreationProgress(t('Namespace created successfully!'));
      setTimeout(() => {
        setShowSuccessDialog(true);
        setIsCreating(false);
      }, 1500);
    } catch (error) {
      console.error('Error creating namespace:', error);
      setCreationError(error instanceof Error ? error.message : t('Failed to create namespace'));
      setIsCreating(false);
      setCreationProgress('');
    }
  };

  const onBack = () => {
    history.push('/');
  };

  const renderStepContent = (step: number) => {
    switch (step) {
      case 0:
        return (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <SearchableSelect
              label={t('Cluster')}
              value={selectedCluster}
              onChange={value => setSelectedCluster(value)}
              options={clusterOptions}
              placeholder={`${t('Select a cluster')}...`}
              searchPlaceholder={`${t('Search clusters')}...`}
              noResultsText={t('No clusters found. Register a cluster first.')}
              showSearch={clusterOptions.length > 5}
            />

            <FormControl fullWidth variant="outlined">
              <FormField
                label={t('Namespace Name')}
                value={namespaceName}
                onChange={value => setNamespaceName(String(value).toLowerCase())}
                error={namespaceName.length > 0 && !NAMESPACE_NAME_REGEX.test(namespaceName)}
                helperText={
                  namespaceName.length > 0 && !NAMESPACE_NAME_REGEX.test(namespaceName)
                    ? t(
                        'Must contain only lowercase letters, numbers, and hyphens, starting and ending with an alphanumeric character'
                      )
                    : t(
                        'The namespace will be created on the selected cluster and set up as a project'
                      )
                }
                endAdornment={<Icon icon="mdi:edit" />}
              />
            </FormControl>
          </Box>
        );
      case 1:
        return (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="h6" gutterBottom>
              {t('Review')}
            </Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: '160px 1fr',
                gap: 1.5,
                p: 2,
                borderRadius: 1,
                border: '1px solid',
                borderColor: 'divider',
              }}
            >
              <Typography variant="body2" color="text.secondary">
                {t('Cluster')}
              </Typography>
              <Typography variant="body2" fontWeight="bold">
                {selectedCluster}
              </Typography>

              <Typography variant="body2" color="text.secondary">
                {t('Namespace Name')}
              </Typography>
              <Typography variant="body2" fontWeight="bold">
                {namespaceName}
              </Typography>

              <Typography variant="body2" color="text.secondary">
                {t('Type')}
              </Typography>
              <Typography variant="body2">{t('Regular Kubernetes namespace')}</Typography>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {t(
                'A new namespace will be created on the cluster with project labels applied. It will appear in your project list immediately.'
              )}
            </Typography>
          </Box>
        );
      default:
        return null;
    }
  };

  return (
    <PageGrid maxWidth="lg" sx={{ margin: '0 auto' }}>
      <SectionBox
        title={t('Create New Namespace')}
        subtitle={t('Create a new namespace on an existing cluster and set it up as a project')}
        backLink="/"
      >
        <Card elevation={2} sx={{ position: 'relative' }}>
          {/* Loading / Success / Error Overlay */}
          {(isCreating || showSuccessDialog || creationError) && (
            <Box
              sx={(theme: Theme) => ({
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: theme.palette.background.muted,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1000,
                borderRadius: '4px',
              })}
            >
              {isCreating && !showSuccessDialog && !creationError ? (
                <>
                  <CircularProgress size={60} />
                  <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>
                    {t('Creating Namespace')}...
                  </Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ textAlign: 'center', maxWidth: 400, px: 2 }}
                  >
                    {creationProgress}
                  </Typography>
                </>
              ) : creationError ? (
                <Box
                  sx={{
                    textAlign: 'center',
                    maxWidth: 700,
                    maxHeight: '70vh',
                    p: 4,
                    backgroundColor: 'background.paper',
                    borderRadius: 2,
                    boxShadow: 3,
                    border: '2px solid',
                    borderColor: 'error.main',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                  }}
                >
                  <Box sx={{ flexShrink: 0 }}>
                    <Icon
                      icon="mdi:alert-circle"
                      width={64}
                      height={64}
                      style={{
                        marginBottom: 12,
                        color: 'var(--color-error, #d32f2f)',
                      }}
                    />
                    <Typography
                      variant="h5"
                      sx={{ mb: 2, color: 'error.main', fontWeight: 'bold' }}
                    >
                      {t('Namespace Creation Failed')}
                    </Typography>
                  </Box>
                  <Box
                    sx={{
                      flex: 1,
                      overflowY: 'auto',
                      mb: 2,
                      minHeight: '100px',
                      maxHeight: '400px',
                    }}
                  >
                    <Typography
                      variant="body2"
                      sx={{
                        whiteSpace: 'pre-wrap',
                        wordWrap: 'break-word',
                        wordBreak: 'break-word',
                        overflowWrap: 'break-word',
                        fontFamily: 'monospace',
                        fontSize: '0.8rem',
                        lineHeight: 1.4,
                        backgroundColor: theme =>
                          theme.palette.mode === 'dark'
                            ? 'rgba(211, 47, 47, 0.15)'
                            : 'rgba(211, 47, 47, 0.08)',
                        color: 'text.primary',
                        padding: 2,
                        borderRadius: 1,
                        border: '1px solid',
                        borderColor: theme =>
                          theme.palette.mode === 'dark'
                            ? 'rgba(211, 47, 47, 0.5)'
                            : 'rgba(211, 47, 47, 0.3)',
                        textAlign: 'left',
                        width: '100%',
                        boxSizing: 'border-box',
                      }}
                    >
                      {creationError}
                    </Typography>
                  </Box>
                  <Box sx={{ flexShrink: 0, display: 'flex', gap: 2, justifyContent: 'center' }}>
                    <Button
                      variant="outlined"
                      color="inherit"
                      onClick={() => {
                        setCreationError(null);
                        setCreationProgress('');
                        onBack();
                      }}
                      sx={{ minWidth: 120 }}
                    >
                      {t('Cancel')}
                    </Button>
                  </Box>
                </Box>
              ) : showSuccessDialog ? (
                <Box
                  sx={{
                    textAlign: 'center',
                    maxWidth: 500,
                    p: 4,
                    backgroundColor: 'background.paper',
                    borderRadius: 2,
                    boxShadow: 3,
                    border: '1px solid',
                    borderColor: 'success.main',
                  }}
                >
                  <Icon
                    icon="mdi:check-circle"
                    width={80}
                    height={80}
                    style={{
                      marginBottom: 16,
                      color: 'var(--color-success, #2e7d32)',
                    }}
                  />
                  <Typography
                    variant="h4"
                    sx={{ mb: 2, color: 'success.main', fontWeight: 'bold' }}
                  >
                    {t('Namespace Created Successfully!')}
                  </Typography>
                  <Typography variant="h6" sx={{ mb: 3, color: 'text.secondary' }}>
                    {t('Your project "{{projectName}}" is ready to use.', {
                      projectName: namespaceName,
                    })}
                  </Typography>
                  <Box sx={{ mb: 3 }}>
                    <TextField
                      fullWidth
                      size="small"
                      value={applicationName}
                      onChange={e => setApplicationName(e.target.value)}
                      placeholder={`${t('Enter application name')}...`}
                      sx={{ mb: 1 }}
                    />
                    <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'left' }}>
                      {t('Enter a name for your first application to get started with deployment.')}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
                    <Button
                      variant="outlined"
                      onClick={() => {
                        setShowSuccessDialog(false);
                        history.push('/');
                      }}
                      sx={{ minWidth: 120 }}
                    >
                      {t('Go To Projects')}
                    </Button>
                    <Button
                      variant="contained"
                      onClick={() => {
                        if (applicationName.trim()) {
                          const projectName = encodeURIComponent(namespaceName);
                          const appName = encodeURIComponent(applicationName.trim());
                          history.push(
                            `/project/${projectName}?openDeploy=true&applicationName=${appName}`
                          );
                        }
                      }}
                      disabled={!applicationName.trim()}
                      sx={{ minWidth: 180 }}
                    >
                      {t('Create Application')}
                    </Button>
                  </Box>
                </Box>
              ) : null}
            </Box>
          )}

          <CardContent
            sx={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              p: 0,
            }}
          >
            {/* Breadcrumbs */}
            <Breadcrumb
              steps={STEPS.map(step => getStepLabel(t, step))}
              activeStep={activeStep}
              onStepClick={step => setActiveStep(step)}
            />

            {/* Step Content */}
            <Box ref={stepContentRef} sx={{ p: 3 }}>
              {renderStepContent(activeStep)}
            </Box>

            {/* Footer */}
            <Box sx={{ p: 3, display: 'flex', alignItems: 'center' }}>
              <Box>
                {activeStep > 0 && (
                  <Button
                    variant="contained"
                    color="secondary"
                    onClick={() => setActiveStep(prev => prev - 1)}
                  >
                    {t('Back')}
                  </Button>
                )}
                {activeStep === 0 && (
                  <Button variant="contained" color="secondary" onClick={onBack}>
                    {t('Cancel')}
                  </Button>
                )}
              </Box>

              <Box sx={{ ml: 'auto' }}>
                {activeStep === STEPS.length - 1 ? (
                  <Button
                    size="large"
                    variant="contained"
                    onClick={handleSubmit}
                    disabled={!validation.isValid}
                  >
                    {t('Create Namespace')}
                  </Button>
                ) : (
                  <Button
                    size="large"
                    variant="contained"
                    onClick={() => setActiveStep(prev => prev + 1)}
                    disabled={!validation.isValid}
                  >
                    {t('Next')}
                  </Button>
                )}
              </Box>
            </Box>
          </CardContent>
        </Card>
      </SectionBox>
    </PageGrid>
  );
}

export default CreateNamespaceContent;
