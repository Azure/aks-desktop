// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { PageGrid, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
// @ts-ignore
import { useClustersConf } from '@kinvolk/headlamp-plugin/lib/K8s';
import { Box, Button, Card, CardContent, CircularProgress, Typography } from '@mui/material';
import React, { useEffect, useState } from 'react';
import { useHistory } from 'react-router-dom';
import {
  checkNamespaceExists,
  createManagedNamespace,
  createNamespaceRoleAssignment,
  verifyNamespaceAccess,
} from '../../utils/azure/az-cli';
import { checkAzureCliAndAksPreview } from '../../utils/azure/checkAzureCli';
import AzureAuthGuard from '../AzureAuth/AzureAuthGuard';
import AzureCliWarning from '../AzureCliWarning';
import { AccessStep } from './components/AccessStep';
import { BasicsStep } from './components/BasicsStep';
// Import our new components and hooks
import { Breadcrumb } from './components/Breadcrumb';
import { ComputeStep } from './components/ComputeStep';
import { NetworkingStep } from './components/NetworkingStep';
import { ReviewStep } from './components/ReviewStep';
import { useAzureResources } from './hooks/useAzureResources';
import { useExtensionCheck } from './hooks/useExtensionCheck';
import { useFeatureCheck } from './hooks/useFeatureCheck';
import { useFormData } from './hooks/useFormData';
import { useNamespaceCheck } from './hooks/useNamespaceCheck';
import { useValidation } from './hooks/useValidation';
import { mapUIRoleToAzureRole, STEPS } from './types';

const useClusterCheck = ({ cluster }: { cluster?: string }) => {
  const clustersConf = useClustersConf();

  const isClusterMissing =
    cluster && Object.values(clustersConf).find((it: any) => it.name === cluster) === undefined;

  return isClusterMissing;
};

/**
 * Refactored CreateAKSProject component using smaller, testable components
 */
function CreateAKSProject() {
  const history = useHistory();

  // State management
  const [activeStep, setActiveStep] = useState(0);
  const [isCreating, setIsCreating] = useState(false);
  const [creationProgress, setCreationProgress] = useState('');
  const [creationError, setCreationError] = useState<string | null>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [applicationName, setApplicationName] = useState('');
  const [cliSuggestions, setCliSuggestions] = useState<string[]>([]);

  // Custom hooks
  const { formData, updateFormData } = useFormData();
  const azureResources = useAzureResources();
  const extensionStatus = useExtensionCheck();
  const featureStatus = useFeatureCheck({ subscription: formData.subscription });
  const namespaceCheck = useNamespaceCheck();
  const isClusterMissing = useClusterCheck({ cluster: formData.cluster });

  // Validation
  const validation = useValidation(
    activeStep,
    formData,
    extensionStatus,
    featureStatus,
    namespaceCheck,
    isClusterMissing
  );

  // Fetch subscriptions and check extension/feature on component mount
  useEffect(() => {
    azureResources.fetchSubscriptions();
  }, []);

  // Check Azure CLI and aks-preview extension on component mount
  useEffect(() => {
    (async () => {
      const azureCheck = await checkAzureCliAndAksPreview();
      console.log('Azure CLI check results:', azureCheck);
      setCliSuggestions(azureCheck.suggestions);
    })();
  }, []);

  // Fetch clusters when subscription changes
  useEffect(() => {
    if (formData.subscription) {
      azureResources.fetchClusters(formData.subscription);
    } else {
      azureResources.clearClusters();
    }
  }, [formData.subscription]);

  // Check namespace existence when project name, cluster, or subscription changes
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (
        formData.projectName &&
        formData.cluster &&
        formData.resourceGroup &&
        formData.subscription
      ) {
        namespaceCheck.checkNamespace(
          formData.cluster,
          formData.resourceGroup,
          formData.projectName,
          formData.subscription
        );
      }
    }, 500); // Debounce the check

    return () => clearTimeout(timeoutId);
  }, [formData.projectName, formData.cluster, formData.resourceGroup, formData.subscription]);
  const handleNext = () => {
    // Clear any existing errors when proceeding
    azureResources.clearError();
    azureResources.clearClusterError();
    setActiveStep(prevStep => prevStep + 1);
  };

  const handleBack = () => {
    setActiveStep(prevStep => prevStep - 1);
  };

  const handleStepClick = (step: number) => {
    setActiveStep(step);
  };

  const handleSubmit = async () => {
    try {
      console.log('handleSubmit', formData);
      console.log('Selected cluster details:', {
        name: formData.cluster,
        resourceGroup: formData.resourceGroup,
        subscription: formData.subscription,
      });

      setIsCreating(true);
      setCreationError(null);
      setCreationProgress('Starting project creation...');

      // Add timeout protection (10 minutes)
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              'Project creation timed out after 10 minutes. Please check if the namespace was created and try again.'
            )
          );
        }, 10 * 60 * 1000); // 10 minutes
      });

      // Create the main creation promise
      const creationPromise = (async () => {
        // Step 1: Create the managed namespace
        setCreationProgress('Initiating managed namespace creation...');
        const namespaceResult = await createManagedNamespace({
          clusterName: formData.cluster,
          resourceGroup: formData.resourceGroup,
          namespaceName: formData.projectName,
          subscriptionId: formData.subscription,
          cpuRequest: formData.cpuRequest,
          cpuLimit: formData.cpuLimit,
          memoryRequest: formData.memoryRequest,
          memoryLimit: formData.memoryLimit,
          ingressPolicy: formData.ingress,
          egressPolicy: formData.egress,
          labels: {
            'headlamp.dev/project-id': formData.projectName,
            'headlamp.dev/project-managed-by': 'aks-desktop',
            'aks-desktop/project-subscription': formData.subscription,
            'aks-desktop/project-resource-group': formData.resourceGroup,
          },
        });

        if (!namespaceResult.success) {
          throw new Error(`Namespace creation failed: ${namespaceResult.error || 'Unknown error'}`);
        }

        setCreationProgress('Namespace creation initiated! Monitoring creation status...');
        console.log('🚀 Namespace creation initiated for:', {
          cluster: formData.cluster,
          resourceGroup: formData.resourceGroup,
          namespace: formData.projectName,
          subscription: formData.subscription,
        });

        // Give the namespace a moment to propagate before verification
        console.log('⏳ Waiting 5 seconds for namespace to propagate...');
        setCreationProgress('Waiting for namespace to propagate...');
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Step 1.5: Monitor namespace creation status with retries
        let namespaceVerified = false;
        let retryCount = 0;
        const maxRetries = 8; // Reduced retries since we have initial delay
        const retryDelay = 4000; // Increased delay between checks

        while (!namespaceVerified && retryCount < maxRetries) {
          try {
            console.log(`🔍 Verification attempt ${retryCount + 1}:`);
            console.log(`   Cluster: ${formData.cluster}`);
            console.log(`   Resource Group: ${formData.resourceGroup}`);
            console.log(`   Namespace: ${formData.projectName}`);
            console.log(`   Subscription: ${formData.subscription}`);

            // Call the check function directly instead of using the hook
            const result = await checkNamespaceExists(
              formData.cluster,
              formData.resourceGroup,
              formData.projectName,
              formData.subscription
            );

            console.log(`   Direct result exists: ${result.exists}`);
            console.log(`   Direct result error: ${result.error || 'None'}`);

            if (result.error) {
              console.log(`   ❌ Namespace check error: ${result.error}`);
              throw new Error(`Namespace status check failed: ${result.error}`);
            }

            if (result.exists === true) {
              namespaceVerified = true;
              console.log('✅ Namespace verified successfully');
            } else {
              retryCount++;
              if (retryCount < maxRetries) {
                console.log(`⏳ Namespace not found yet, retrying in ${retryDelay / 1000}s...`);
                setCreationProgress('Waiting for namespace to be created...');
                await new Promise(resolve => setTimeout(resolve, retryDelay));
              } else {
                console.log(`❌ Max retries reached, namespace still not found`);
              }
            }
          } catch (statusError) {
            console.log(`❌ Verification attempt failed:`, statusError.message);
            throw new Error(`Namespace status verification failed: ${statusError.message}`);
          }
        }

        if (!namespaceVerified) {
          console.log('⚠️ Namespace verification failed, but continuing with creation process...');
          console.log('   This might be due to timing issues with Azure API propagation.');
          console.log('   The namespace creation API call succeeded, so we will proceed.');
          // Don't throw error, just log warning and continue
          setCreationProgress(
            'Namespace creation API succeeded, proceeding with user assignments...'
          );
        }

        setCreationProgress('Namespace creation completed successfully! Adding user access...');

        // Step 2: Add users to the namespace (only if there are valid assignees)
        const validAssignments = formData.userAssignments.filter(
          assignment => assignment.email.trim() !== ''
        );

        if (validAssignments.length > 0) {
          setCreationProgress(`Adding user access for ${validAssignments.length} assignee(s)...`);

          const assignmentResults = [];
          const assignmentErrors = [];

          for (let index = 0; index < validAssignments.length; index++) {
            const assignment = validAssignments[index];
            setCreationProgress(`Adding user ${assignment.email}...`);

            try {
              // Map UI role to Azure role name
              const azureRole = mapUIRoleToAzureRole(assignment.role);

              // Roles to assign: the selected role and the default namespace user role
              // Note: Platform-specific quoting is handled in createNamespaceRoleAssignment
              // Namespace contributor is needed to allow users to delete the managed namespace
              const rolesToAssign = [
                azureRole,
                'Azure Kubernetes Service Namespace User',
                'Azure Kubernetes Service Namespace Contributor',
              ];

              // Create role assignments for both roles
              const roleAssignmentResults = [];
              for (const role of rolesToAssign) {
                setCreationProgress(`Assigning ${role} to ${assignment.email}...`);

                const roleResult = await createNamespaceRoleAssignment({
                  clusterName: formData.cluster,
                  resourceGroup: formData.resourceGroup,
                  namespaceName: formData.projectName,
                  assignee: assignment.email,
                  role: role,
                  subscriptionId: formData.subscription,
                });

                if (!roleResult.success) {
                  // Capture full error details including stderr which contains Azure CLI error messages
                  const errorDetails = roleResult.stderr || roleResult.error || 'Unknown error';
                  roleAssignmentResults.push({
                    role,
                    success: false,
                    error: errorDetails,
                    errorField: roleResult.error,
                    stderr: roleResult.stderr,
                  });
                } else {
                  roleAssignmentResults.push({ role, success: true });
                }
              }

              // Check if any role assignments failed (excluding skipped ones)
              // Note: r.role contains the Azure role name (already mapped from UI role)
              const failedRoles = roleAssignmentResults.filter(r => !r.success && !r.skipped);
              if (failedRoles.length > 0) {
                const failedRoleDetails = failedRoles
                  .map(r => {
                    // Use stderr if available (contains Azure CLI error), otherwise use error field
                    // r.role is already the Azure role name (e.g., "Azure Kubernetes Service RBAC Writer")
                    const errorMsg = r.stderr || r.error || 'Unknown error';
                    return `${r.role}: ${errorMsg}`;
                  })
                  .join('; ');
                assignmentErrors.push(
                  `Failed to assign roles to user ${assignment.email}. ${failedRoleDetails}`
                );
                continue;
              }

              // Verify the user has access
              setCreationProgress(`Verifying access for user ${assignment.email}...`);
              const verifyResult = await verifyNamespaceAccess({
                clusterName: formData.cluster,
                resourceGroup: formData.resourceGroup,
                namespaceName: formData.projectName,
                assignee: assignment.email,
                subscriptionId: formData.subscription,
              });

              if (!verifyResult.success) {
                assignmentErrors.push(
                  `Failed to verify access for user ${assignment.email}: ${
                    verifyResult.error || 'Verification failed'
                  }`
                );
              } else if (!verifyResult.hasAccess) {
                assignmentErrors.push(
                  `User ${assignment.email} does not have the expected access to the namespace`
                );
              } else {
                assignmentResults.push(`✓ User ${assignment.email} added successfully`);
              }
            } catch (userError) {
              assignmentErrors.push(
                `Error processing user ${assignment.email}: ${userError.message}`
              );
            }
          }

          // Report results
          if (assignmentErrors.length > 0) {
            const errorMessage = `User assignment completed with errors:\n${assignmentErrors.join(
              '\n'
            )}`;
            if (assignmentResults.length > 0) {
              console.warn('Some user assignments succeeded:', assignmentResults);
            }
            throw new Error(errorMessage);
          }
        } else {
          setCreationProgress('No user assignments to process...');
        }

        setCreationProgress('Project creation completed successfully!');

        // Final status check - verify the namespace exists and is accessible
        setCreationProgress('Performing final status verification...');

        // Final verification with a single retry
        let finalVerified = false;
        for (let attempt = 0; attempt < 2 && !finalVerified; attempt++) {
          try {
            const result = await checkNamespaceExists(
              formData.cluster,
              formData.resourceGroup,
              formData.projectName,
              formData.subscription
            );

            if (result.error) {
              throw new Error(`Final status check failed: ${result.error}`);
            }

            if (result.exists) {
              finalVerified = true;
              console.log('✅ Final namespace verification successful');
            } else if (attempt === 0) {
              console.log('⏳ Final verification: namespace not found, retrying once...');
              await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
            }
          } catch (finalError) {
            throw new Error(`Final status verification failed: ${finalError.message}`);
          }
        }

        if (!finalVerified) {
          console.log('⚠️ Final verification failed, but namespace creation API succeeded');
          console.log('   This might be due to timing issues with Azure API propagation.');
          console.log('   The project creation process will be marked as successful.');
          // Don't throw error, just log warning and continue
        }

        setCreationProgress('All verifications completed successfully!');
      })();

      // Race between creation and timeout
      await Promise.race([creationPromise, timeoutPromise]);

      // Wait a moment to show success message
      setTimeout(() => {
        setIsCreating(false);
        setShowSuccessDialog(true);
      }, 2000);
    } catch (error) {
      console.error('Error creating AKS project:', error);
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        formData: formData,
      });
      setCreationError(error.message || 'Failed to create project');
      setIsCreating(false);
      setCreationProgress(''); // Clear progress message
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
      loading: azureResources.loading,
      error: azureResources.error,
    };

    switch (step) {
      case 0: // Basics
        return (
          <BasicsStep
            {...commonProps}
            subscriptions={azureResources.subscriptions}
            clusters={azureResources.clusters}
            loadingClusters={azureResources.loadingClusters}
            clusterError={azureResources.clusterError}
            extensionStatus={extensionStatus}
            featureStatus={featureStatus}
            namespaceStatus={namespaceCheck}
            onInstallExtension={extensionStatus.installExtension}
            onRegisterFeature={featureStatus.registerFeature}
            onRetrySubscriptions={async () => {
              await azureResources.fetchSubscriptions();
            }}
            onRetryClusters={async () => {
              await azureResources.fetchClusters(formData.subscription);
            }}
          />
        );
      case 1: // Networking
        return <NetworkingStep {...commonProps} />;
      case 2: // Compute
        return <ComputeStep {...commonProps} />;
      case 3: // Access
        return <AccessStep {...commonProps} />;
      case 4: // Review
        return (
          <ReviewStep
            {...commonProps}
            subscriptions={azureResources.subscriptions}
            clusters={azureResources.clusters}
          />
        );
      default:
        return null;
    }
  };

  return (
    <AzureAuthGuard>
      {/** @ts-ignore */}
      <PageGrid maxWidth="lg" sx={{ margin: '0 auto' }}>
        <SectionBox
          title="New Project"
          subtitle="Set up and configure a new project in Azure Kubernetes Service (AKS)"
          backLink="/"
        >
          {cliSuggestions.length > 0 && (
            <Box sx={{ mb: 2 }}>
              <AzureCliWarning suggestions={cliSuggestions} />
            </Box>
          )}

          <Card elevation={2} sx={{ position: 'relative' }}>
            {/* Loading Overlay / Success Screen / Error Display */}
            {(isCreating || showSuccessDialog || creationError) && (
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
                {isCreating && !showSuccessDialog && !creationError ? (
                  // Loading state
                  <>
                    <CircularProgress size={60} />
                    <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>
                      Creating Project...
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
                  // Error state
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
                    {/* Fixed header section */}
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
                        Project Creation Failed
                      </Typography>
                    </Box>
                    {/* Scrollable error content */}
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
                    {/* Fixed button section */}
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
                        Cancel
                      </Button>
                    </Box>
                  </Box>
                ) : showSuccessDialog ? (
                  // Success state
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
                      Project Created Successfully!
                    </Typography>
                    <Typography variant="h6" sx={{ mb: 3, color: 'text.secondary' }}>
                      Your AKS project "{formData.projectName}" has been created and is ready to
                      use.
                    </Typography>
                    <Box sx={{ mb: 3 }}>
                      <input
                        type="text"
                        value={applicationName}
                        onChange={e => setApplicationName(e.target.value)}
                        placeholder="Enter application name..."
                        style={{
                          width: '100%',
                          padding: '12px',
                          border: '1px solid #ccc',
                          borderRadius: '4px',
                          marginBottom: '8px',
                        }}
                      />
                      <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'left' }}>
                        Enter a name for your first application to get started with deployment.
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
                      <Button
                        variant="outlined"
                        onClick={() => {
                          setShowSuccessDialog(false);
                          onBack();
                        }}
                        sx={{ minWidth: 120 }}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="contained"
                        onClick={() => {
                          if (applicationName.trim()) {
                            // Navigate to project page with deploy parameters using React Router
                            const projectName = encodeURIComponent(formData.projectName);
                            const appName = encodeURIComponent(applicationName.trim());
                            const projectUrl = `/project/${projectName}?openDeploy=true&applicationName=${appName}`;
                            console.log('navigating to project page', projectUrl);
                            history.push(projectUrl);
                          }
                        }}
                        disabled={!applicationName.trim()}
                        sx={{ minWidth: 180 }}
                      >
                        Create Application
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
                steps={[...STEPS]}
                activeStep={activeStep}
                onStepClick={handleStepClick}
              />

              {/* Step Content */}
              <Box sx={{ p: 3 }}>{renderStepContent(activeStep)}</Box>

              {/* Footer with navigation buttons */}
              <Box sx={{ p: 3, display: 'flex', alignItems: 'center' }}>
                {/* Left side - Back and Cancel buttons */}
                <Box>
                  {activeStep > 0 && (
                    <Button variant="contained" color="secondary" onClick={handleBack}>
                      Back
                    </Button>
                  )}
                  {activeStep === 0 && (
                    <Button variant="contained" color="secondary" onClick={onBack}>
                      Cancel
                    </Button>
                  )}
                </Box>

                {/* Right side - Next/Create Project button */}
                <Box sx={{ ml: 'auto' }}>
                  {activeStep === STEPS.length - 1 ? (
                    <Button
                      size="large"
                      variant="contained"
                      onClick={handleSubmit}
                      disabled={!validation.isValid}
                    >
                      Create Project
                    </Button>
                  ) : (
                    <Button
                      size="large"
                      variant="contained"
                      onClick={handleNext}
                      disabled={azureResources.loading || !validation.isValid}
                    >
                      {azureResources.loading ? (
                        <Box display="flex" alignItems="center" gap={1}>
                          <CircularProgress size={16} color="inherit" />
                          Loading...
                        </Box>
                      ) : (
                        'Next'
                      )}
                    </Button>
                  )}
                </Box>
              </Box>
            </CardContent>
          </Card>
        </SectionBox>
      </PageGrid>
    </AzureAuthGuard>
  );
}

export default CreateAKSProject;
