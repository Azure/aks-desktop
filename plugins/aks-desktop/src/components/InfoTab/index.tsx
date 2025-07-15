// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { K8s } from '@kinvolk/headlamp-plugin/lib';
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  Typography,
} from '@mui/material';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getClusterResourceIdAndGroup,
  getManagedNamespaceDetails,
  getManagedNamespaces,
  updateManagedNamespace,
} from '../../utils/azure/az-cli';
import ComputeStep from '../CreateAKSProject/components/ComputeStep';
import NetworkingStep from '../CreateAKSProject/components/NetworkingStep';
import { DEFAULT_FORM_DATA, type FormData, type ValidationState } from '../CreateAKSProject/types';
import { validateComputeQuota, validateNetworkingPolicies } from '../CreateAKSProject/validators';

interface InfoTabProps {
  project: {
    clusters: string[];
    namespaces: string[];
    id: string;
  };
}

const InfoTab: React.FC<InfoTabProps> = ({ project }) => {
  const [clusterInfo, setClusterInfo] = useState<{
    resourceId: string;
    resourceGroup: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  type NamespaceDetails = {
    properties?: {
      defaultNetworkPolicy?: {
        ingress?: string;
        egress?: string;
      };
      defaultResourceQuota?: {
        cpuRequest?: string;
        cpuLimit?: string;
        memoryRequest?: string;
        memoryLimit?: string;
      };
    };
  };

  const [namespaceInstance] = K8s.ResourceClasses.Namespace.useGet(
    project.namespaces[0],
    undefined,
    {
      cluster: project.clusters[0],
    }
  );
  const subscription =
    namespaceInstance?.jsonData?.metadata?.labels?.['aks-desktop/project-subscription'];

  const [namespaceDetails, setNamespaceDetails] = useState<NamespaceDetails | null>(null);
  const [formData, setFormData] = useState<FormData>(DEFAULT_FORM_DATA);
  const [baselineFormData, setBaselineFormData] = useState<FormData | null>(null);
  const [updating, setUpdating] = useState(false);
  const [validation, setValidation] = useState<ValidationState>({
    isValid: true,
    errors: [],
    warnings: [],
    fieldErrors: {},
  });

  useEffect(() => {
    let isMounted = true;
    const clusterName = project?.clusters?.[0];
    if (!clusterName) {
      setClusterInfo(null);
      setError('No cluster selected');
      return () => {
        isMounted = false;
      };
    }

    if (!subscription) return;

    (async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await getClusterResourceIdAndGroup(clusterName, subscription);
        if (isMounted) setClusterInfo(result);
      } catch (error) {
        console.error(error);
        if (isMounted) {
          setClusterInfo(null);
          setError('Failed to fetch cluster info');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [project, subscription]);

  useEffect(() => {
    let isMounted = true;
    const clusterName = project?.clusters?.[0];
    const resourceGroup = clusterInfo?.resourceGroup;
    if (!clusterName || !resourceGroup) {
      // reset namespace-related state when prerequisites are missing
      setNamespaceDetails(null);
      return () => {
        isMounted = false;
      };
    }

    (async () => {
      try {
        setLoading(true);
        setError(null);
        const nsList = await getManagedNamespaces({
          clusterName,
          resourceGroup,
          subscriptionId: subscription,
        });

        if (isMounted && nsList.length > 0) {
          const managedNamespace = project.id;
          const details = await getManagedNamespaceDetails({
            clusterName,
            resourceGroup,
            namespaceName: managedNamespace,
            subscriptionId: subscription,
          });
          if (isMounted) setNamespaceDetails(details);
        } else if (isMounted) {
          setNamespaceDetails(null);
        }
      } catch (e) {
        console.error(e);
        if (isMounted) {
          setError('Failed to fetch managed namespaces');
          setNamespaceDetails(null);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [clusterInfo, project]);

  // Utils reused across renders
  const normalizePolicy = useCallback((value: string): FormData['ingress'] => {
    const allowed: Record<FormData['ingress'], true> = {
      AllowSameNamespace: true,
      AllowAll: true,
      DenyAll: true,
    };
    if ((value as keyof typeof allowed) in allowed) {
      return value as FormData['ingress'];
    }
    return 'AllowSameNamespace';
  }, []);

  const parseMillicores = useCallback((val: string): number => {
    const n = parseInt(String(val).replace(/m$/i, ''), 10);
    return Number.isFinite(n) ? n : 0;
  }, []);

  const parseMiB = useCallback((val: string): number => {
    const n = parseInt(String(val).replace(/Mi$/i, ''), 10);
    return Number.isFinite(n) ? n : 0;
  }, []);

  // When namespace details are fetched, pre-populate the forms
  useEffect(() => {
    if (!namespaceDetails) return;

    const ingress = normalizePolicy(
      namespaceDetails?.properties?.defaultNetworkPolicy?.ingress ?? 'AllowSameNamespace'
    );
    const egress = normalizePolicy(
      namespaceDetails?.properties?.defaultNetworkPolicy?.egress ?? 'AllowAll'
    );

    const cpuReqStr = namespaceDetails?.properties?.defaultResourceQuota?.cpuRequest ?? '0m';
    const cpuLimStr = namespaceDetails?.properties?.defaultResourceQuota?.cpuLimit ?? '0m';
    const memReqStr = namespaceDetails?.properties?.defaultResourceQuota?.memoryRequest ?? '0Mi';
    const memLimStr = namespaceDetails?.properties?.defaultResourceQuota?.memoryLimit ?? '0Mi';

    const populated: FormData = {
      ...DEFAULT_FORM_DATA,
      ingress,
      egress,
      cpuRequest: parseMillicores(cpuReqStr),
      cpuLimit: parseMillicores(cpuLimStr),
      memoryRequest: parseMiB(memReqStr),
      memoryLimit: parseMiB(memLimStr),
      projectName: DEFAULT_FORM_DATA.projectName,
      description: DEFAULT_FORM_DATA.description,
      subscription: DEFAULT_FORM_DATA.subscription,
      cluster: DEFAULT_FORM_DATA.cluster,
      resourceGroup: DEFAULT_FORM_DATA.resourceGroup,
    };

    setFormData(populated);
    setBaselineFormData(populated);
  }, [namespaceDetails]);

  const handleFormDataChange = useCallback(
    (updates: Partial<FormData>) => {
      setFormData(prev => ({ ...prev, ...updates }));
      setValidation(prev => {
        const next = { ...prev, fieldErrors: {} as Record<string, string[]> } as ValidationState;
        const compute = validateComputeQuota({
          cpuRequest: (updates.cpuRequest ?? formData.cpuRequest) as number,
          cpuLimit: (updates.cpuLimit ?? formData.cpuLimit) as number,
          memoryRequest: (updates.memoryRequest ?? formData.memoryRequest) as number,
          memoryLimit: (updates.memoryLimit ?? formData.memoryLimit) as number,
        });
        const networking = validateNetworkingPolicies({
          ingress: (updates.ingress ?? formData.ingress) as any,
          egress: (updates.egress ?? formData.egress) as any,
        });

        const fieldErrors: Record<string, string[]> = {};
        if (compute.fieldErrors) Object.assign(fieldErrors, compute.fieldErrors);
        if (!networking.isValid) fieldErrors.networking = networking.errors;

        next.fieldErrors = fieldErrors;
        next.errors = [...(compute.errors || []), ...(networking.errors || [])];
        next.isValid = compute.isValid && networking.isValid;
        return next;
      });
    },
    [formData]
  );

  const hasChanges = useMemo(() => {
    if (!baselineFormData) return false;
    const keys: (keyof FormData)[] = [
      'ingress',
      'egress',
      'cpuRequest',
      'cpuLimit',
      'memoryRequest',
      'memoryLimit',
    ];
    return keys.some(k => formData[k] !== baselineFormData[k]);
  }, [baselineFormData, formData]);

  const handleSave = useCallback(async () => {
    if (!clusterInfo?.resourceGroup) return;
    const clusterName = project?.clusters?.[0];
    const resourceGroup = clusterInfo.resourceGroup;
    const managedNamespace = project.id;
    if (!clusterName || !resourceGroup || !managedNamespace) return;

    try {
      setUpdating(true);
      await updateManagedNamespace({
        clusterName,
        resourceGroup,
        namespaceName: managedNamespace,
        ingressPolicy: formData.ingress as any,
        egressPolicy: formData.egress as any,
        cpuRequest: formData.cpuRequest,
        cpuLimit: formData.cpuLimit,
        memoryRequest: formData.memoryRequest,
        memoryLimit: formData.memoryLimit,
        noWait: false,
      });
      // After a successful update, reset the baseline so the button disables
      setBaselineFormData(formData);
    } catch (e) {
      console.error('Failed to update managed namespace', e);
      setError('Failed to update managed namespace');
    } finally {
      setUpdating(false);
    }
  }, [clusterInfo?.resourceGroup, formData, project?.clusters, project.id]);

  return (
    <Card>
      <CardContent sx={{ minHeight: loading ? '100vh' : 'auto' }}>
        {loading && (
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              py: 4,
              height: '100%',
            }}
          >
            <CircularProgress />
          </Box>
        )}
        {!loading && error && <Typography color="error">{error}</Typography>}

        {!loading && !error && clusterInfo && namespaceDetails && (
          <Box>
            <Box sx={{ mb: 3 }}>
              <NetworkingStep
                formData={formData}
                onFormDataChange={handleFormDataChange}
                validation={validation}
                loading={loading}
              />
            </Box>
            <Divider sx={{ my: 2 }} />
            <Box>
              <ComputeStep
                formData={formData}
                onFormDataChange={handleFormDataChange}
                validation={validation}
                loading={loading}
              />
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 3 }}>
              <Button
                variant="contained"
                color="primary"
                disabled={!project.id || !hasChanges || !validation.isValid || updating}
                onClick={handleSave}
              >
                {updating ? 'Updating…' : 'Update'}
              </Button>
            </Box>
          </Box>
        )}
      </CardContent>
    </Card>
  );
};

export default InfoTab;
