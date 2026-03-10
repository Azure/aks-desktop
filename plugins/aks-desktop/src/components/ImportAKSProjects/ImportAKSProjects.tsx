// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  ActionButton,
  PageGrid,
  SectionBox,
  Table,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Alert, Box, Button, Chip } from '@mui/material';
import React from 'react';
import type { DiscoveredNamespace } from '../../hooks/useNamespaceDiscovery';
import AzureAuthGuard from '../AzureAuth/AzureAuthGuard';
import { ConversionDialog } from './components/ConversionDialog';
import { useImportAKSProjects } from './hooks/useImportAKSProjects';

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
    handleCancel,
    handleGoToProjects,
  } = useImportAKSProjects();

  const displayError = error || discoveryError || '';
  const showNamespaceTable = !importResults || importResults.every(result => !result.success);

  return (
    <PageGrid>
      <SectionBox
        title={t('Import AKS Projects')}
        subtitle={t('Browse and import existing AKS Projects')}
        backLink="/"
        headerProps={{
          headerStyle: 'subsection',
          actions: showNamespaceTable
            ? [
                <ActionButton
                  key="refresh"
                  description={t('Refresh')}
                  icon="mdi:refresh"
                  onClick={refresh}
                  iconButtonProps={{
                    disabled: importing || loadingNamespaces,
                    'aria-busy': loadingNamespaces || undefined,
                  }}
                />,
              ]
            : [],
        }}
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

        {showNamespaceTable && (
          <Table
            enableRowSelection
            loading={loadingNamespaces}
            data={namespaces}
            getRowId={namespace => `${namespace.clusterName}/${namespace.name}`}
            columns={[
              {
                header: t('Name'),
                accessorFn: (n: DiscoveredNamespace) => n.name,
              },
              {
                header: t('Type'),
                accessorFn: (n: DiscoveredNamespace) =>
                  n.isManagedNamespace ? t('AKS Managed') : t('Regular'),
                gridTemplate: 'min-content',
                Cell: ({ row: { original: ns } }: { row: { original: DiscoveredNamespace } }) => (
                  <Chip
                    label={ns.isManagedNamespace ? t('AKS Managed') : t('Regular')}
                    color={ns.isManagedNamespace ? 'primary' : 'default'}
                    size="small"
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
                accessorFn: (n: DiscoveredNamespace) => (n.isAksProject ? t('Yes') : t('No')),
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
            renderRowSelectionToolbar={({ table }) => {
              const selectedRows = table.getSelectedRowModel().rows;
              const importLabel = t('Import Selected Projects');

              return (
                <Button
                  size="small"
                  variant="contained"
                  color="primary"
                  disabled={importing || loadingNamespaces}
                  aria-busy={importing || undefined}
                  aria-label={
                    importing ? t('Importing') : `${importLabel} (${selectedRows.length})`
                  }
                  onClick={() =>
                    handleImportClick(
                      selectedRows.map(row => ({
                        namespace: row.original as DiscoveredNamespace,
                      }))
                    )
                  }
                  startIcon={<Icon icon="mdi:import" />}
                >
                  {importing ? t('Importing') + '...' : importLabel}
                </Button>
              );
            }}
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
              <Button
                variant="contained"
                color="secondary"
                onClick={handleCancel}
                disabled={importing}
              >
                {t('Close')}
              </Button>
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
