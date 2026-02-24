// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  Box,
  Button,
  CircularProgress,
  Radio,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import React from 'react';
import { ValidationAlert } from '../../CreateAKSProject/components/ValidationAlert';
import type { ExtensionStatus } from '../../CreateAKSProject/types';
import type { DiscoveredNamespace } from '../hooks/useNamespaceDiscovery';

export interface NamespaceSelectionStepProps {
  needsConversion: DiscoveredNamespace[];
  needsImport: DiscoveredNamespace[];
  loading: boolean;
  error: string | null;
  selectedNamespace: DiscoveredNamespace | null;
  onSelectNamespace: (ns: DiscoveredNamespace) => void;
  extensionStatus: ExtensionStatus;
  onInstallExtension: () => Promise<void>;
  onRefresh: () => Promise<void>;
}

function NamespaceTable({
  namespaces,
  selectedNamespace,
  onSelect,
  disabled,
}: {
  namespaces: DiscoveredNamespace[];
  selectedNamespace: DiscoveredNamespace | null;
  onSelect: (ns: DiscoveredNamespace) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();

  if (namespaces.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
        {t('No namespaces found in this category')}
      </Typography>
    );
  }

  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell padding="checkbox" />
            <TableCell>{t('Namespace')}</TableCell>
            <TableCell>{t('Cluster')}</TableCell>
            <TableCell>{t('Resource Group')}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {namespaces.map(ns => {
            const key = `${ns.subscriptionId}/${ns.clusterName}/${ns.name}`;
            const isSelected =
              selectedNamespace?.name === ns.name &&
              selectedNamespace?.clusterName === ns.clusterName &&
              selectedNamespace?.subscriptionId === ns.subscriptionId;

            return (
              <TableRow
                key={key}
                hover
                onClick={() => !disabled && onSelect(ns)}
                selected={isSelected}
                sx={{ cursor: disabled ? 'default' : 'pointer' }}
              >
                <TableCell padding="checkbox">
                  <Radio checked={isSelected} disabled={disabled} size="small" />
                </TableCell>
                <TableCell>{ns.name}</TableCell>
                <TableCell>{ns.clusterName}</TableCell>
                <TableCell>{ns.resourceGroup}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export const NamespaceSelectionStep: React.FC<NamespaceSelectionStepProps> = ({
  needsConversion,
  needsImport,
  loading,
  error,
  selectedNamespace,
  onSelectNamespace,
  extensionStatus,
  onInstallExtension,
  onRefresh,
}) => {
  const { t } = useTranslation();
  const totalCount = needsConversion.length + needsImport.length;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box>
        <Typography variant="h5" component="h2" gutterBottom>
          {t('Select a Namespace')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t(
            'Choose an existing managed namespace to convert into a project. The namespace will be labeled as an AKS Desktop project.'
          )}
        </Typography>
      </Box>

      {/* Extension warnings */}
      {extensionStatus.installed === false && (
        <ValidationAlert
          type="warning"
          message={t('AKS Preview Extension must be installed to manage namespaces')}
          action={
            <Button
              size="small"
              onClick={onInstallExtension}
              disabled={extensionStatus.installing}
              startIcon={extensionStatus.installing ? <CircularProgress size={16} /> : undefined}
            >
              {extensionStatus.installing ? t('Installing') + '...' : t('Install Extension')}
            </Button>
          }
        />
      )}

      {extensionStatus.showSuccess && (
        <ValidationAlert type="success" message={t('Extension installed successfully!')} />
      )}

      {/* Error state */}
      {error && <ValidationAlert type="error" message={error} />}

      {/* Loading state */}
      {loading && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={32} sx={{ mr: 2 }} />
          <Typography variant="body1" color="text.secondary">
            {t('Discovering managed namespaces')}...
          </Typography>
        </Box>
      )}

      {/* Results */}
      {!loading && !error && (
        <>
          {totalCount === 0 ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <Icon icon="mdi:folder-search-outline" width={48} height={48} />
              <Typography variant="body1" sx={{ mt: 2 }}>
                {t('No managed namespaces found')}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {t(
                  'Ensure you have managed namespaces in your Azure subscriptions that are not already projects.'
                )}
              </Typography>
            </Box>
          ) : (
            <>
              {/* Needs Conversion section */}
              {needsConversion.length > 0 && (
                <Box>
                  <Typography
                    variant="h6"
                    gutterBottom
                    sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                  >
                    <Icon icon="mdi:folder-swap-outline" />
                    {t('Available for Conversion')}
                    <Typography component="span" variant="body2" color="text.secondary">
                      ({needsConversion.length})
                    </Typography>
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {t('Managed namespaces that are not yet projects')}
                  </Typography>
                  <NamespaceTable
                    namespaces={needsConversion}
                    selectedNamespace={selectedNamespace}
                    onSelect={onSelectNamespace}
                  />
                </Box>
              )}

              {/* Needs Import section */}
              {needsImport.length > 0 && (
                <Box>
                  <Typography
                    variant="h6"
                    gutterBottom
                    sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                  >
                    <Icon icon="mdi:import" />
                    {t('Available for Import')}
                    <Typography component="span" variant="body2" color="text.secondary">
                      ({needsImport.length})
                    </Typography>
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {t('Already labeled as projects but not imported locally')}
                  </Typography>
                  <NamespaceTable
                    namespaces={needsImport}
                    selectedNamespace={selectedNamespace}
                    onSelect={onSelectNamespace}
                  />
                </Box>
              )}
            </>
          )}

          {/* Refresh button */}
          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              size="small"
              variant="text"
              startIcon={<Icon icon="mdi:refresh" />}
              onClick={onRefresh}
            >
              {t('Refresh')}
            </Button>
          </Box>
        </>
      )}
    </Box>
  );
};
