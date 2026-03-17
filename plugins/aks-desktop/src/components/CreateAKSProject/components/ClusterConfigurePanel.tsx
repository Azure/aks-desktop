// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
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
import type { AddonKey } from '../../../utils/azure/az-cli';
import { enableClusterAddon, getClusterCapabilities } from '../../../utils/azure/az-cli';

interface ClusterConfigurePanelProps {
  capabilities: ClusterCapabilities;
  subscriptionId: string;
  resourceGroup: string;
  clusterName: string;
  onConfigured: () => void;
}

interface AddonOption {
  key: AddonKey;
  capabilityField: keyof ClusterCapabilities;
}

const ADDON_OPTIONS: AddonOption[] = [
  { key: 'azure-monitor-metrics', capabilityField: 'prometheusEnabled' },
  { key: 'keda', capabilityField: 'kedaEnabled' },
  { key: 'vpa', capabilityField: 'vpaEnabled' },
];

function getAddonLabel(t: (key: string) => string, key: AddonKey): string {
  switch (key) {
    case 'azure-monitor-metrics':
      return t('Azure Monitor Metrics (Managed Prometheus)');
    case 'keda':
      return t('KEDA (Event-Driven Autoscaling)');
    case 'vpa':
      return t('VPA (Vertical Pod Autoscaler)');
    default: {
      const _exhaustive: never = key;
      return String(_exhaustive);
    }
  }
}

const MAX_POLL_ATTEMPTS = 30;
const POLL_INTERVAL_MS = 10000;

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
  const { t } = useTranslation();
  const [selectedAddons, setSelectedAddons] = useState<Set<AddonKey>>(new Set());
  const [enabling, setEnabling] = useState(false);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const pollingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onConfiguredRef = useRef(onConfigured);
  const clusterParamsRef = useRef({ subscriptionId, resourceGroup, clusterName });

  // Determine which addons are missing vs already enabled
  const missingAddons = ADDON_OPTIONS.filter(addon => capabilities[addon.capabilityField] !== true);
  const enabledAddons = ADDON_OPTIONS.filter(addon => capabilities[addon.capabilityField] === true);

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

  // Keep refs in sync with latest props
  useEffect(() => {
    onConfiguredRef.current = onConfigured;
  }, [onConfigured]);

  useEffect(() => {
    clusterParamsRef.current = { subscriptionId, resourceGroup, clusterName };
  }, [subscriptionId, resourceGroup, clusterName]);

  // Pre-select all missing addons when capabilities change.
  // missingAddonsKey is a stable string derived from missingAddons to avoid object identity issues.
  const missingAddonsKey = missingAddons.map(a => a.key).join(',');
  useEffect(() => {
    setSelectedAddons(new Set(missingAddons.map(a => a.key)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          t(
            'Configuration is taking longer than expected. Please check the Azure portal for the current status of your cluster.'
          )
        );
        return;
      }

      try {
        const params = clusterParamsRef.current;
        const updatedCapabilities = await getClusterCapabilities({
          subscriptionId: params.subscriptionId,
          resourceGroup: params.resourceGroup,
          clusterName: params.clusterName,
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
    [t]
  );

  const handleConfigure = async () => {
    if (selectedAddons.size === 0) return;

    setEnabling(true);
    setError(null);
    setSuccess(false);

    try {
      const result = await enableClusterAddon({
        subscriptionId,
        resourceGroup,
        clusterName,
        addon: Array.from(selectedAddons),
      });

      if (!result.success) {
        setError(result.error || t('Failed to enable addons'));
        return;
      }
    } catch (err) {
      setError(
        t('Failed to enable addon: {{error}}', {
          error: err instanceof Error ? err.message : t('Unknown error'),
        })
      );
      return;
    } finally {
      setEnabling(false);
    }

    // Start polling for completion
    const addonsToWatch = new Set(selectedAddons);
    setPolling(true);
    pollForCompletion(addonsToWatch, 0);
  };

  // Don't render if there are no configurable addons (all already enabled) and no network warning
  if (missingAddons.length === 0 && !hasNetworkPolicyWarning) {
    return null;
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
        {t('Cluster Configuration')}
      </Typography>
      {/* Already-enabled addons: checked and disabled */}
      {enabledAddons.length > 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', ml: 1 }}>
          {enabledAddons.map(addon => (
            <FormControlLabel
              key={addon.key}
              control={<Checkbox checked disabled size="small" />}
              label={
                <Typography variant="body2">
                  {getAddonLabel(t, addon.key)} {t('(already enabled)')}
                </Typography>
              }
            />
          ))}
        </Box>
      )}

      {/* Helper text and missing addons: toggleable */}
      {missingAddons.length > 0 && (
        <>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mb: 1, mt: enabledAddons.length > 0 ? 1 : 0 }}
          >
            {t('The following addons can be enabled on this cluster:')}
          </Typography>
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
                label={<Typography variant="body2">{getAddonLabel(t, addon.key)}</Typography>}
              />
            ))}
          </Box>
        </>
      )}

      {/* Network policy info (non-actionable) */}
      {hasNetworkPolicyWarning && (
        <Alert severity="info" sx={{ mt: 1 }}>
          {t(
            'Network policy engine cannot be changed after cluster creation. Create a new cluster with'
          )}{' '}
          <code>
            --network-plugin azure --network-plugin-mode overlay --network-dataplane cilium
          </code>{' '}
          {t('for full network policy support.')}
        </Alert>
      )}

      {/* Cost warning — only when there are addons to enable */}
      {missingAddons.length > 0 && (
        <Alert severity="warning" sx={{ mt: 1 }} icon={false}>
          <Typography variant="body2">
            {t('Enabling these addons may incur additional Azure costs.')}
          </Typography>
        </Alert>
      )}

      {/* Error message */}
      {error && (
        <Alert severity="error" sx={{ mt: 1 }} onClose={() => setError(null)}>
          <AlertTitle>{t('Configuration Error')}</AlertTitle>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
            {error}
          </Typography>
        </Alert>
      )}

      {/* Success message */}
      {success && (
        <Alert severity="success" sx={{ mt: 1 }}>
          <AlertTitle>{t('Configuration Complete')}</AlertTitle>
          {t('All selected addons have been enabled successfully.')}
        </Alert>
      )}

      {/* Polling progress — visual indicator */}
      {polling && (
        <Box display="flex" alignItems="center" gap={1} sx={{ mt: 1 }}>
          <CircularProgress size={16} aria-hidden="true" />
          <Typography variant="body2" color="text.secondary" aria-hidden="true">
            {t('Configuring cluster... This may take a few minutes.')}
          </Typography>
        </Box>
      )}

      {/* Persistent live region for polling status announcements.
          This element stays in the DOM at all times so that screen readers register
          it before content changes.  Placing role="status" inside a conditional
          block ({polling && …}) caused Narrator to miss or cut off the announcement
          because the region and its text appeared in the same React commit.
          MDN: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/status_role */}
      <Box
        role="status"
        aria-live="polite"
        aria-atomic="true"
        sx={{
          position: 'absolute',
          width: '1px',
          height: '1px',
          padding: 0,
          margin: '-1px',
          overflow: 'hidden',
          clip: 'rect(0, 0, 0, 0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {polling ? t('Configuring cluster... This may take a few minutes.') : ''}
      </Box>

      {/* Configure button — only when there are addons to enable */}
      {!success && missingAddons.length > 0 && (
        /* aria-busy signals to AT that the button is performing an async operation.
           The CircularProgress spinner is decorative and hidden from AT with aria-hidden
           because the button text ("Enabling Addons...") already conveys the busy state.
           MDN: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-busy */
        <Button
          variant="contained"
          onClick={handleConfigure}
          disabled={enabling || polling || selectedAddons.size === 0}
          sx={{ mt: 2 }}
          aria-busy={enabling || polling || undefined}
          startIcon={
            enabling ? <CircularProgress size={16} color="inherit" aria-hidden="true" /> : undefined
          }
        >
          {enabling
            ? t('Enabling Addons...')
            : polling
            ? t('Configuring...')
            : t('Configure Cluster')}
        </Button>
      )}
    </Box>
  );
};
