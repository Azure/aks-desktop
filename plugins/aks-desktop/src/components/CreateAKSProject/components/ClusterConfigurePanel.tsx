// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  Typography,
} from '@mui/material';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ClusterCapabilities } from '../../../types/ClusterCapabilities';
import { enableClusterAddon, getClusterCapabilities } from '../../../utils/azure/az-cli';

interface ClusterConfigurePanelProps {
  capabilities: ClusterCapabilities;
  subscriptionId: string;
  resourceGroup: string;
  clusterName: string;
  onConfigured: () => void;
}

type AddonKey = 'azure-monitor-metrics' | 'keda' | 'vpa';

interface AddonOption {
  key: AddonKey;
  label: string;
  capabilityField: keyof ClusterCapabilities;
}

const ADDON_OPTIONS: AddonOption[] = [
  {
    key: 'azure-monitor-metrics',
    label: 'Azure Monitor Metrics (Managed Prometheus)',
    capabilityField: 'prometheusEnabled',
  },
  {
    key: 'keda',
    label: 'KEDA (Event-Driven Autoscaling)',
    capabilityField: 'kedaEnabled',
  },
  {
    key: 'vpa',
    label: 'VPA (Vertical Pod Autoscaler)',
    capabilityField: 'vpaEnabled',
  },
];

const MAX_POLL_ATTEMPTS = 30;
const POLL_INTERVAL_MS = 10000;

const NETWORK_POLICY_INFO = (
  <>
    Network policy engine cannot be changed after cluster creation. Create a new cluster with{' '}
    <code>--network-policy cilium</code> for full network policy support.
  </>
);

/**
 * Panel for enabling missing addons on a Standard AKS cluster.
 * Shows checkboxes for each addon that can be enabled post-creation,
 * and polls for completion after enabling.
 */
export const ClusterConfigurePanel: React.FC<ClusterConfigurePanelProps> = ({
  capabilities,
  subscriptionId,
  resourceGroup,
  clusterName,
  onConfigured,
}) => {
  const [selectedAddons, setSelectedAddons] = useState<Set<AddonKey>>(new Set());
  const [enabling, setEnabling] = useState(false);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const pollingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onConfiguredRef = useRef(onConfigured);

  // Determine which addons are missing
  const missingAddons = ADDON_OPTIONS.filter(addon => capabilities[addon.capabilityField] !== true);

  const hasNetworkPolicyWarning =
    !capabilities.networkPolicy || capabilities.networkPolicy === 'none';

  // Clean up polling timer on unmount
  useEffect(() => {
    return () => {
      if (pollingTimerRef.current) {
        clearTimeout(pollingTimerRef.current);
      }
    };
  }, []);

  // Keep onConfigured ref in sync with latest prop
  useEffect(() => {
    onConfiguredRef.current = onConfigured;
  }, [onConfigured]);

  // Pre-select all missing addons on mount
  const missingAddonsKey = missingAddons.map(a => a.key).join(',');
  useEffect(() => {
    setSelectedAddons(new Set(missingAddons.map(a => a.key)));
  }, [missingAddonsKey]);

  // Reset configuration state when the cluster changes
  useEffect(() => {
    setError(null);
    setSuccess(false);
    setEnabling(false);
    setPolling(false);
    if (pollingTimerRef.current) {
      clearTimeout(pollingTimerRef.current);
      pollingTimerRef.current = null;
    }
  }, [clusterName]);

  const handleToggleAddon = (addonKey: AddonKey) => {
    setSelectedAddons(prev => {
      const next = new Set(prev);
      if (next.has(addonKey)) {
        next.delete(addonKey);
      } else {
        next.add(addonKey);
      }
      return next;
    });
  };

  const pollForCompletion = useCallback(
    async (addonsToCheck: Set<AddonKey>, attempt: number) => {
      if (attempt >= MAX_POLL_ATTEMPTS) {
        setPolling(false);
        setError(
          'Configuration is taking longer than expected. ' +
            'Please check the Azure portal for the current status of your cluster.'
        );
        return;
      }

      try {
        const updatedCapabilities = await getClusterCapabilities({
          subscriptionId,
          resourceGroup,
          clusterName,
        });

        // Check if all selected addons are now enabled
        const allEnabled = Array.from(addonsToCheck).every(addonKey => {
          const option = ADDON_OPTIONS.find(o => o.key === addonKey);
          if (!option) return true;
          return updatedCapabilities[option.capabilityField] === true;
        });

        if (allEnabled) {
          setPolling(false);
          setSuccess(true);
          onConfiguredRef.current();
          return;
        }

        // Schedule next poll
        pollingTimerRef.current = setTimeout(() => {
          pollForCompletion(addonsToCheck, attempt + 1);
        }, POLL_INTERVAL_MS);
      } catch (pollError) {
        // Don't stop polling on transient errors, just log and continue
        console.error('Error polling cluster capabilities:', pollError);
        pollingTimerRef.current = setTimeout(() => {
          pollForCompletion(addonsToCheck, attempt + 1);
        }, POLL_INTERVAL_MS);
      }
    },
    [subscriptionId, resourceGroup, clusterName]
  );

  const handleConfigure = async () => {
    if (selectedAddons.size === 0) return;

    setEnabling(true);
    setError(null);
    setSuccess(false);

    const results = await Promise.allSettled(
      Array.from(selectedAddons).map(addonKey =>
        enableClusterAddon({
          subscriptionId,
          resourceGroup,
          clusterName,
          addon: addonKey,
        }).then(result => ({ addonKey, result }))
      )
    );

    const errors: string[] = [];
    for (const settled of results) {
      if (settled.status === 'rejected') {
        const err = settled.reason;
        errors.push(
          `Failed to enable addon: ${err instanceof Error ? err.message : 'Unknown error'}`
        );
      } else if (!settled.value.result.success) {
        errors.push(settled.value.result.error || `Failed to enable ${settled.value.addonKey}`);
      }
    }

    setEnabling(false);

    if (errors.length > 0) {
      setError(errors.join('\n'));
      return;
    }

    // Start polling for completion
    const addonsToWatch = new Set(selectedAddons);
    setPolling(true);
    pollForCompletion(addonsToWatch, 0);
  };

  // Don't render if there are no configurable addons (all already enabled)
  if (missingAddons.length === 0 && !hasNetworkPolicyWarning) {
    return null;
  }

  if (missingAddons.length === 0) {
    return (
      <Box
        sx={{
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          p: 2,
        }}
      >
        <Typography variant="subtitle2" gutterBottom>
          Cluster Configuration
        </Typography>
        <Alert severity="info" sx={{ mt: 1 }}>
          {NETWORK_POLICY_INFO}
        </Alert>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        p: 2,
      }}
    >
      <Typography variant="subtitle2" gutterBottom>
        Cluster Configuration
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        The following addons can be enabled on this cluster:
      </Typography>

      {/* Addon checkboxes */}
      <Box sx={{ display: 'flex', flexDirection: 'column', ml: 1 }}>
        {missingAddons.map(addon => (
          <FormControlLabel
            key={addon.key}
            control={
              <Checkbox
                checked={selectedAddons.has(addon.key)}
                onChange={() => handleToggleAddon(addon.key)}
                disabled={enabling || polling || success}
                size="small"
              />
            }
            label={<Typography variant="body2">{addon.label}</Typography>}
          />
        ))}
      </Box>

      {/* Network policy info (non-actionable) */}
      {hasNetworkPolicyWarning && (
        <Alert severity="info" sx={{ mt: 1 }}>
          {NETWORK_POLICY_INFO}
        </Alert>
      )}

      {/* Cost warning */}
      <Alert severity="warning" sx={{ mt: 1 }} icon={false}>
        <Typography variant="body2">
          Enabling these addons may incur additional Azure costs.
        </Typography>
      </Alert>

      {/* Error message */}
      {error && (
        <Alert severity="error" sx={{ mt: 1 }} onClose={() => setError(null)}>
          <AlertTitle>Configuration Error</AlertTitle>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
            {error}
          </Typography>
        </Alert>
      )}

      {/* Success message */}
      {success && (
        <Alert severity="success" sx={{ mt: 1 }}>
          <AlertTitle>Configuration Complete</AlertTitle>
          All selected addons have been enabled successfully.
        </Alert>
      )}

      {/* Polling progress */}
      {polling && (
        <Box display="flex" alignItems="center" gap={1} sx={{ mt: 1 }}>
          <CircularProgress size={16} />
          <Typography variant="body2" color="text.secondary">
            Configuring cluster... This may take a few minutes.
          </Typography>
        </Box>
      )}

      {/* Configure button */}
      {!success && (
        <Button
          variant="contained"
          onClick={handleConfigure}
          disabled={enabling || polling || selectedAddons.size === 0}
          sx={{ mt: 2 }}
          startIcon={enabling ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {enabling ? 'Enabling Addons...' : polling ? 'Configuring...' : 'Configure Cluster'}
        </Button>
      )}
    </Box>
  );
};
