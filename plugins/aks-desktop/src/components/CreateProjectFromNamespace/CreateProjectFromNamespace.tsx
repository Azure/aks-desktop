// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { PageGrid, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Button, Card, CardContent, CircularProgress, Typography } from '@mui/material';
import React, { useEffect, useMemo, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { registerAKSCluster } from '../../utils/azure/aks';
import { updateManagedNamespace } from '../../utils/azure/az-cli';
import { checkAzureCliAndAksPreview } from '../../utils/azure/checkAzureCli';
import { assignRolesToNamespace } from '../../utils/azure/roleAssignment';
import { applyProjectLabels } from '../../utils/kubernetes/namespaceUtils';
import AzureAuthGuard from '../AzureAuth/AzureAuthGuard';
import AzureCliWarning from '../AzureCliWarning';
import { AccessStep } from '../CreateAKSProject/components/AccessStep';
import { Breadcrumb } from '../CreateAKSProject/components/Breadcrumb';
import { ComputeStep } from '../CreateAKSProject/components/ComputeStep';
import { NetworkingStep } from '../CreateAKSProject/components/NetworkingStep';
import { useExtensionCheck } from '../CreateAKSProject/hooks/useExtensionCheck';
import { useFormData } from '../CreateAKSProject/hooks/useFormData';
import {
  validateAccessStep,
  validateComputeQuota,
  validateNetworkingPolicies,
} from '../CreateAKSProject/validators';
import { FromNamespaceReviewStep } from './components/FromNamespaceReviewStep';
import { NamespaceSelectionStep } from './components/NamespaceSelectionStep';
import { DiscoveredNamespace, useNamespaceDiscovery } from './hooks/useNamespaceDiscovery';

const STEPS = [
  'Select Namespace',
  'Networking Policies',
  'Compute Quota',
  'Access',
  'Review',
] as const;

function CreateProjectFromNamespaceContent() {
  const history = useHistory();
  const { t } = useTranslation();

  // State management
  const [activeStep, setActiveStep] = useState(0);
  const [isConverting, setIsConverting] = useState(false);
  const [conversionProgress, setConversionProgress] = useState('');
  const [conversionError, setConversionError] = useState<string | null>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [applicationName, setApplicationName] = useState('');
  const [selectedNamespace, setSelectedNamespace] = useState<DiscoveredNamespace | null>(null);
  const [cliSuggestions, setCliSuggestions] = useState<string[]>([]);

  // Hooks
  const { formData, updateFormData } = useFormData();
  const namespaceDiscovery = useNamespaceDiscovery();
  const extensionStatus = useExtensionCheck();

  // Check Azure CLI on mount
  useEffect(() => {
    (async () => {
      const azureCheck = await checkAzureCliAndAksPreview();
      setCliSuggestions(azureCheck.suggestions);
    })();
  }, []);

  // When namespace is selected, populate formData
  useEffect(() => {
    if (selectedNamespace) {
      updateFormData({
        projectName: selectedNamespace.name,
        subscription: selectedNamespace.subscriptionId,
        cluster: selectedNamespace.clusterName,
        resourceGroup: selectedNamespace.resourceGroup,
      });
    }
  }, [selectedNamespace]);

  // Validation per step
  const validation = useMemo(() => {
    switch (activeStep) {
      case 0: {
        // Namespace Selection: must have selection and extension installed
        const errors: string[] = [];
        if (!selectedNamespace) {
          errors.push('A namespace must be selected');
        }
        if (extensionStatus.installed === false) {
          errors.push('AKS Preview Extension must be installed');
        }
        return { isValid: errors.length === 0, errors, warnings: [] as string[] };
      }
      case 1: {
        const result = validateNetworkingPolicies({
          ingress: formData.ingress,
          egress: formData.egress,
        });
        return { ...result, warnings: result.warnings || [] };
      }
      case 2: {
        const result = validateComputeQuota({
          cpuRequest: formData.cpuRequest,
          cpuLimit: formData.cpuLimit,
          memoryRequest: formData.memoryRequest,
          memoryLimit: formData.memoryLimit,
        });
        return { ...result, warnings: result.warnings || [] };
      }
      case 3: {
        const result = validateAccessStep(formData.userAssignments);
        return { ...result, warnings: result.warnings || [] };
      }
      case 4:
        return { isValid: true, errors: [] as string[], warnings: [] as string[] };
      default:
        return { isValid: false, errors: ['Invalid step'], warnings: [] as string[] };
    }
  }, [activeStep, selectedNamespace, extensionStatus.installed, formData]);

  const handleNext = () => {
    setActiveStep(prev => prev + 1);
  };

  const handleBack = () => {
    setActiveStep(prev => prev - 1);
  };

  const handleStepClick = (step: number) => {
    setActiveStep(step);
  };

  const handleSubmit = async () => {
    if (!selectedNamespace) return;

    try {
      setIsConverting(true);
      setConversionError(null);
      setConversionProgress(`${t('Starting namespace conversion')}...`);

      const isImportOnly = selectedNamespace.category === 'needs-import';

      // Timeout protection (10 minutes)
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              t(
                'Conversion timed out after 10 minutes. Please check the namespace status and try again.'
              )
            )
          );
        }, 10 * 60 * 1000);
      });

      const conversionPromise = (async () => {
        // Step 1: Apply project labels (if not already labeled)
        if (!isImportOnly) {
          setConversionProgress(`${t('Applying project labels')}...`);
          await applyProjectLabels({
            namespaceName: selectedNamespace.name,
            clusterName: selectedNamespace.clusterName,
            subscriptionId: selectedNamespace.subscriptionId,
            resourceGroup: selectedNamespace.resourceGroup,
          });
          console.log('✅ Project labels applied successfully');
        }

        // Step 2: Update networking/compute configuration
        setConversionProgress(`${t('Updating namespace configuration')}...`);
        try {
          await updateManagedNamespace({
            clusterName: selectedNamespace.clusterName,
            resourceGroup: selectedNamespace.resourceGroup,
            namespaceName: selectedNamespace.name,
            subscriptionId: selectedNamespace.subscriptionId,
            cpuRequest: formData.cpuRequest,
            cpuLimit: formData.cpuLimit,
            memoryRequest: formData.memoryRequest,
            memoryLimit: formData.memoryLimit,
            ingressPolicy: formData.ingress,
            egressPolicy: formData.egress,
          });
          console.log('✅ Namespace configuration updated');
        } catch (updateError) {
          console.warn('⚠️ Configuration update failed, continuing:', updateError);
          // Don't throw — config update failure is non-fatal for conversion
        }

        // Step 3: Register cluster locally
        setConversionProgress(`${t('Registering cluster')}...`);
        const registerResult = await registerAKSCluster(
          selectedNamespace.subscriptionId,
          selectedNamespace.resourceGroup,
          selectedNamespace.clusterName,
          selectedNamespace.name
        );

        if (!registerResult.success) {
          throw new Error(
            t('Failed to register cluster: {{message}}', {
              message: registerResult.message,
            })
          );
        }
        console.log('✅ Cluster registered successfully');

        // Step 4: Update allowed namespaces in localStorage
        try {
          const settings = JSON.parse(
            localStorage.getItem(`cluster_settings.${selectedNamespace.clusterName}`) || '{}'
          );
          settings.allowedNamespaces ??= [];
          if (!settings.allowedNamespaces.includes(selectedNamespace.name)) {
            settings.allowedNamespaces.push(selectedNamespace.name);
          }
          localStorage.setItem(
            `cluster_settings.${selectedNamespace.clusterName}`,
            JSON.stringify(settings)
          );
        } catch (e) {
          console.error('Failed to update allowed namespaces:', e);
        }

        // Step 5: Add user role assignments
        const roleResult = await assignRolesToNamespace({
          clusterName: selectedNamespace.clusterName,
          resourceGroup: selectedNamespace.resourceGroup,
          namespaceName: selectedNamespace.name,
          subscriptionId: selectedNamespace.subscriptionId,
          assignments: formData.userAssignments,
          onProgress: msg => setConversionProgress(msg),
        });

        if (!roleResult.success) {
          const errorMessage = `${t(
            'User assignment completed with errors'
          )}\n${roleResult.errors.join('\n')}`;
          if (roleResult.results.length > 0) {
            console.warn('Some user assignments succeeded:', roleResult.results);
          }
          throw new Error(errorMessage);
        }

        setConversionProgress(t('Conversion completed successfully!'));
      })();

      await Promise.race([conversionPromise, timeoutPromise]);

      setTimeout(() => {
        setIsConverting(false);
        setShowSuccessDialog(true);
      }, 2000);
    } catch (error) {
      console.error('Error converting namespace to project:', error);
      setConversionError(error instanceof Error ? error.message : t('Failed to convert namespace'));
      setIsConverting(false);
      setConversionProgress('');
    }
  };

  const onBack = () => {
    history.push('/');
  };

  const renderStepContent = (step: number) => {
    const commonProps = {
      formData,
      onFormDataChange: updateFormData,
      validation,
    };

    switch (step) {
      case 0:
        return (
          <NamespaceSelectionStep
            needsConversion={namespaceDiscovery.needsConversion}
            needsImport={namespaceDiscovery.needsImport}
            loading={namespaceDiscovery.loading}
            error={namespaceDiscovery.error}
            selectedNamespace={selectedNamespace}
            onSelectNamespace={setSelectedNamespace}
            extensionStatus={extensionStatus}
            onInstallExtension={extensionStatus.installExtension}
            onRefresh={namespaceDiscovery.refresh}
          />
        );
      case 1:
        return <NetworkingStep {...commonProps} />;
      case 2:
        return <ComputeStep {...commonProps} />;
      case 3:
        return <AccessStep {...commonProps} />;
      case 4:
        return selectedNamespace ? (
          <FromNamespaceReviewStep formData={formData} selectedNamespace={selectedNamespace} />
        ) : null;
      default:
        return null;
    }
  };

  return (
    <>
      {/** @ts-ignore */}
      <PageGrid maxWidth="lg" sx={{ margin: '0 auto' }}>
        <SectionBox
          title={t('Project from Existing Namespace')}
          subtitle={t('Convert an existing AKS managed namespace into a project')}
          backLink="/"
        >
          {cliSuggestions.length > 0 && (
            <Box sx={{ mb: 2 }}>
              <AzureCliWarning suggestions={cliSuggestions} />
            </Box>
          )}

          <Card elevation={2} sx={{ position: 'relative' }}>
            {/* Loading / Success / Error Overlay */}
            {(isConverting || showSuccessDialog || conversionError) && (
              <Box
                sx={(theme: any) => ({
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
                {isConverting && !showSuccessDialog && !conversionError ? (
                  <>
                    <CircularProgress size={60} />
                    <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>
                      {t('Converting Namespace')}...
                    </Typography>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ textAlign: 'center', maxWidth: 400, px: 2 }}
                    >
                      {conversionProgress}
                    </Typography>
                  </>
                ) : conversionError ? (
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
                        {t('Conversion Failed')}
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
                        {conversionError}
                      </Typography>
                    </Box>
                    <Box sx={{ flexShrink: 0, display: 'flex', gap: 2, justifyContent: 'center' }}>
                      <Button
                        variant="outlined"
                        color="inherit"
                        onClick={() => {
                          setConversionError(null);
                          setConversionProgress('');
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
                      color="success.main"
                      style={{ marginBottom: 16 }}
                    />
                    <Typography
                      variant="h4"
                      sx={{ mb: 2, color: 'success.main', fontWeight: 'bold' }}
                    >
                      {selectedNamespace?.category === 'needs-import'
                        ? t('Project Imported Successfully!')
                        : t('Namespace Converted Successfully!')}
                    </Typography>
                    <Typography variant="h6" sx={{ mb: 3, color: 'text.secondary' }}>
                      {t('Your AKS project "{{projectName}}" is ready to use.', {
                        projectName: selectedNamespace?.name || formData.projectName,
                      })}
                    </Typography>
                    <Box sx={{ mb: 3 }}>
                      <input
                        type="text"
                        value={applicationName}
                        onChange={e => setApplicationName(e.target.value)}
                        placeholder={`${t('Enter application name')}...`}
                        style={{
                          width: '100%',
                          padding: '12px',
                          border: '1px solid #ccc',
                          borderRadius: '4px',
                          marginBottom: '8px',
                        }}
                      />
                      <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'left' }}>
                        {t(
                          'Enter a name for your first application to get started with deployment.'
                        )}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
                      <Button
                        variant="outlined"
                        onClick={() => {
                          setShowSuccessDialog(false);
                          history.replace('/');
                          window.location.reload();
                        }}
                        sx={{ minWidth: 120 }}
                      >
                        {t('Go To Projects')}
                      </Button>
                      <Button
                        variant="contained"
                        onClick={() => {
                          if (applicationName.trim() && selectedNamespace) {
                            const projectName = encodeURIComponent(selectedNamespace.name);
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
                steps={STEPS.map(step => t(step))}
                activeStep={activeStep}
                onStepClick={handleStepClick}
              />

              {/* Step Content */}
              <Box sx={{ p: 3 }}>{renderStepContent(activeStep)}</Box>

              {/* Footer */}
              <Box sx={{ p: 3, display: 'flex', alignItems: 'center' }}>
                <Box>
                  {activeStep > 0 && (
                    <Button variant="contained" color="secondary" onClick={handleBack}>
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
                      {selectedNamespace?.category === 'needs-import'
                        ? t('Import Project')
                        : t('Convert to Project')}
                    </Button>
                  ) : (
                    <Button
                      size="large"
                      variant="contained"
                      onClick={handleNext}
                      disabled={namespaceDiscovery.loading || !validation.isValid}
                    >
                      {namespaceDiscovery.loading ? (
                        <Box display="flex" alignItems="center" gap={1}>
                          <CircularProgress size={16} color="inherit" />
                          {t('Loading')}...
                        </Box>
                      ) : (
                        t('Next')
                      )}
                    </Button>
                  )}
                </Box>
              </Box>
            </CardContent>
          </Card>
        </SectionBox>
      </PageGrid>
    </>
  );
}

export default function CreateProjectFromNamespace() {
  return (
    <AzureAuthGuard>
      <CreateProjectFromNamespaceContent />
    </AzureAuthGuard>
  );
}
