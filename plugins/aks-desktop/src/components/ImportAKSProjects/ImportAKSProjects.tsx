// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { PageGrid, SectionBox, Table } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Alert, Box, Button, Chip, CircularProgress } from '@mui/material';
import React from 'react';
import type { DiscoveredNamespace } from '../../hooks/useNamespaceDiscovery';
import AzureAuthGuard from '../AzureAuth/AzureAuthGuard';
import { ConversionDialog } from './components/ConversionDialog';
import { ImportSelection, useImportAKSProjects } from './hooks/useImportAKSProjects';

function ImportAKSProjectsContent() {
  const { t } = useTranslation();
  const {
    error,
    success,
    namespaces,
    loadingNamespaces,
    discoveryError,
    importing,
    importResults,
    showConversionDialog,
    namespacesToConvert,
    namespacesToImport,
    refresh,
    clearError,
    clearSuccess,
    clearDiscoveryError,
    handleImportClick,
    handleConversionConfirm,
    handleConversionClose,
    handleGoToProjects,
  } = useImportAKSProjects();

  const displayError = error || discoveryError || '';

  return (
    <PageGrid>
      <SectionBox
        title={t('Import AKS Projects')}
        subtitle={t('Browse and import existing AKS Projects')}
        backLink="/"
      >
        {displayError && (
          <Alert severity="error" onClose={error ? clearError : clearDiscoveryError} sx={{ mb: 2 }}>
            {displayError}
          </Alert>
        )}

        {success && (
          <Alert severity="success" onClose={clearSuccess} sx={{ mb: 2 }}>
            {success}
          </Alert>
        )}

        {(!importResults || importResults.every(r => !r.success)) && (
          <Table
            enableRowSelection
            loading={loadingNamespaces}
            data={namespaces}
            columns={[
              {
                header: t('Name'),
                accessorFn: (n: DiscoveredNamespace) => n.name,
              },
              {
                header: t('Type'),
                accessorFn: (n: DiscoveredNamespace) =>
                  n.isManagedNamespace ? 'AKS Managed' : 'Regular',
                gridTemplate: 'min-content',
                Cell: ({ row: { original: ns } }: { row: { original: DiscoveredNamespace } }) => (
                  <Chip
                    label={ns.isManagedNamespace ? t('AKS Managed') : t('Regular')}
                    color={ns.isManagedNamespace ? 'primary' : 'default'}
                    size="small"
                    variant="outlined"
                  />
                ),
              },
              {
                header: t('Cluster'),
                accessorFn: (n: DiscoveredNamespace) => n.clusterName,
              },
              {
                header: t('Resource Group'),
                accessorFn: (n: DiscoveredNamespace) => n.resourceGroup,
              },
              {
                header: t('AKS Project?'),
                accessorFn: (n: DiscoveredNamespace) => (n.isAksProject ? 'Yes' : 'No'),
                gridTemplate: 'min-content',
                Cell: ({ row: { original: ns } }: { row: { original: DiscoveredNamespace } }) =>
                  ns.isAksProject ? (
                    <Chip
                      icon={<Icon icon="mdi:check-circle" />}
                      label={t('Yes')}
                      color="success"
                      size="small"
                      variant="outlined"
                    />
                  ) : (
                    <Chip
                      icon={<Icon icon="mdi:close-circle" />}
                      label={t('No')}
                      color="default"
                      size="small"
                      variant="outlined"
                    />
                  ),
              },
            ]}
            renderRowSelectionToolbar={({ table }) => (
              <>
                <Button
                  size="small"
                  variant="contained"
                  color="secondary"
                  onClick={refresh}
                  disabled={importing || loadingNamespaces}
                  startIcon={<Icon icon="mdi:refresh" />}
                >
                  {t('Refresh')}
                </Button>
                <Button
                  variant="contained"
                  color="primary"
                  disabled={importing || loadingNamespaces}
                  onClick={() =>
                    handleImportClick(
                      table.getSelectedRowModel().rows.map(
                        r =>
                          ({
                            namespace: r.original as DiscoveredNamespace,
                          } as ImportSelection)
                      )
                    )
                  }
                  startIcon={
                    importing ? <CircularProgress size={20} /> : <Icon icon="mdi:import" />
                  }
                >
                  {importing ? t('Importing') + '...' : t('Import Selected Projects')}
                </Button>
              </>
            )}
          />
        )}

        {importResults && importResults.length > 0 && (
          <>
            <Box sx={{ mt: 2 }}>
              {importResults.map(result => (
                <Alert
                  key={`${result.clusterName}/${result.namespace}`}
                  severity={result.success ? 'success' : 'error'}
                  sx={{ mb: 1 }}
                >
                  <strong>{result.namespace}</strong>: {result.message}
                </Alert>
              ))}
            </Box>
            <Box sx={{ mt: 3, display: 'flex', gap: 2 }}>
              {importResults.some(r => r.success) && (
                <Button
                  variant="contained"
                  color="primary"
                  onClick={handleGoToProjects}
                  startIcon={<Icon icon="mdi:folder-open" />}
                >
                  {t('Go To Projects')}
                </Button>
              )}
            </Box>
          </>
        )}
      </SectionBox>

      <ConversionDialog
        open={showConversionDialog}
        onClose={handleConversionClose}
        onConfirm={handleConversionConfirm}
        namespacesToConvert={namespacesToConvert}
        namespacesToImport={namespacesToImport}
        converting={importing}
      />
    </PageGrid>
  );
}

export default function ImportAKSProjects() {
  return (
    <AzureAuthGuard>
      <ImportAKSProjectsContent />
    </AzureAuthGuard>
  );
}
