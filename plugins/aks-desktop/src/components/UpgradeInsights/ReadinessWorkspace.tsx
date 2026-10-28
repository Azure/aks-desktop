// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  Alert,
  Button,
  CircularProgress,
  MenuItem,
  Pagination,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import React, { useMemo, useState } from 'react';
import type { InsightsProvider } from '../../types/upgradeInsights';
import ClusterDetails from './ClusterDetails';
import { contextCandidates } from './contextSelection';
import InventoryTable from './InventoryTable';
import { usePageRecords, useReadinessInventory } from './useReadinessInventory';

/** Maximum clusters whose stored evaluations are loaded for one inventory page. */
const PAGE_SIZE = 10;

/** Inventory and generation coordination within one authenticated subscription selection. */
export interface ReadinessWorkspaceProps {
  /** Session-owned data source; replacing it aborts reads from the old provider. */
  provider: InsightsProvider;
  /** Enable registered-context scoping and explicit ARM-identity disambiguation guidance. */
  requireClusterSelection: boolean;
  /** Optional context registration key used only to narrow inventory candidates. */
  contextName?: string;
  /**
   * Prevent subscription edits in the owning session during generation.
   * @param busy Whether a confirmed generation request is in flight.
   * @returns No value.
   */
  onBusyChange: (busy: boolean) => void;
}

/**
 * Browse reachable inventory and page-scoped readiness without initiating upgrades.
 * @param props Authenticated data source, optional context policy, and parent edit-lock callback.
 * @returns Inventory controls, coverage errors/warnings, selected cluster details, and page results.
 */
export default function ReadinessWorkspace({
  provider,
  requireClusterSelection,
  contextName,
  onBusyChange,
}: ReadinessWorkspaceProps) {
  const { t } = useTranslation();
  const [refresh, setRefresh] = useState(0);
  const { inventory, loading, error } = useReadinessInventory(provider, refresh);
  const [query, setQuery] = useState('');
  const [region, setRegion] = useState('');
  const [sort, setSort] = useState('name');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const candidates = useMemo(
    () =>
      requireClusterSelection
        ? contextCandidates(inventory.clusters, contextName)
        : inventory.clusters,
    [inventory.clusters, requireClusterSelection, contextName]
  );
  const matched = useMemo(
    () =>
      candidates
        .filter(
          cluster =>
            (!region || cluster.location === region) &&
            [
              cluster.name,
              cluster.id,
              cluster.location,
              cluster.subscription,
              cluster.resourceGroup,
              cluster.environment ?? '',
              ...(cluster.fleets ?? []).map(fleet => fleet.name),
            ]
              .join(' ')
              .toLowerCase()
              .includes(query.toLowerCase())
        )
        .sort((a, b) =>
          (sort === 'region' ? a.location : a.name).localeCompare(
            sort === 'region' ? b.location : b.name
          )
        ),
    [candidates, query, region, sort]
  );
  const pageCount = Math.max(1, Math.ceil(matched.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageClusters = useMemo(
    () => matched.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [matched, currentPage]
  );
  const { records, loading: recordsLoading } = usePageRecords(provider, pageClusters, refresh);
  const selected = candidates.find(c => c.id === selectedId);

  /**
   * Keep local selection locks and the owning session's subscription locks synchronized.
   * @param value Whether confirmed generation is in flight.
   * @returns No value.
   */
  function changeBusy(value: boolean) {
    setBusy(value);
    onBusyChange(value);
  }

  /**
   * Invalidate insight snapshots once before re-reading inventory and the visible page.
   * @returns No value; later pagination resumes the provider's normal cache policy.
   */
  function refreshReadiness() {
    provider.invalidateInsights();
    setRefresh(n => n + 1);
  }

  if (error) {
    return (
      <Alert
        severity="error"
        action={<Button onClick={refreshReadiness}>{t('Retry inventory')}</Button>}
      >
        {t('Could not load cluster inventory: {{error}}', { error })}
      </Alert>
    );
  }

  return (
    <Stack spacing={2}>
      <Button disabled={busy || loading || recordsLoading} onClick={refreshReadiness}>
        {t('Refresh inventory and current page')}
      </Button>
      {!!inventory.warnings.length && (
        <Alert severity="warning">
          <Typography>
            {t('Partial cluster inventory — counts cover reachable subscriptions only.')}
          </Typography>
          {inventory.warnings.map((warning, index) => (
            <Typography key={index}>{warning}</Typography>
          ))}
        </Alert>
      )}
      {!!inventory.fleetWarnings.length && (
        <Alert severity="warning">
          <Typography>
            {t(
              'Fleet membership is incomplete. Missing membership is not proof of a standalone cluster.'
            )}
          </Typography>
          {inventory.fleetWarnings.map((warning, index) => (
            <Typography key={index}>{warning}</Typography>
          ))}
        </Alert>
      )}
      {requireClusterSelection && (
        <Alert severity="info">
          {t(
            'Select the exact Azure ARM resource for this Kubernetes context. Registered subscription and resource-group metadata narrows the choices when available. Context names are not authoritative; no cluster is selected by name.'
          )}
        </Alert>
      )}
      {requireClusterSelection && !loading && !!inventory.clusters.length && !candidates.length && (
        <Alert severity="warning">
          {t(
            'No managed AKS resources match this context’s registered scope. Arc-connected contexts are not managed AKS resources. Use the Home inventory to browse other scopes.'
          )}
        </Alert>
      )}
      <TextField
        select
        label={t('Cluster details — select ARM resource')}
        value={selected?.id ?? ''}
        disabled={busy}
        onChange={event => setSelectedId(event.target.value)}
      >
        <MenuItem value="">{t('Select a cluster')}</MenuItem>
        {candidates.map(cluster => (
          <MenuItem key={cluster.id} value={cluster.id}>
            {cluster.id}
          </MenuItem>
        ))}
      </TextField>
      {selected && (
        <ClusterDetails
          key={selected.id}
          cluster={selected}
          provider={provider}
          refresh={refresh}
          onBusyChange={changeBusy}
          onGenerated={refreshReadiness}
        />
      )}
      <Typography variant="h5">{t('Cluster readiness inventory')}</Typography>
      <Typography>
        {t(
          '{{count}} clusters in inventory. Readiness counts, risk filters, sorting by readiness, and export apply to the current page only.',
          {
            count: candidates.length,
          }
        )}
      </Typography>
      <Stack direction="row" spacing={2} flexWrap="wrap">
        <TextField
          label={t('Search clusters, subscriptions, regions or fleets')}
          value={query}
          disabled={busy}
          onChange={event => {
            setQuery(event.target.value);
            setPage(1);
          }}
        />
        <TextField
          select
          label={t('Region')}
          value={region}
          disabled={busy}
          sx={{ minWidth: 150 }}
          onChange={event => {
            setRegion(event.target.value);
            setPage(1);
          }}
        >
          <MenuItem value="">{t('All regions')}</MenuItem>
          {[...new Set(candidates.map(c => c.location))].sort().map(location => (
            <MenuItem key={location} value={location}>
              {location}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label={t('Inventory sort')}
          value={sort}
          disabled={busy}
          onChange={event => {
            setSort(event.target.value);
            setPage(1);
          }}
        >
          <MenuItem value="name">{t('Cluster name')}</MenuItem>
          <MenuItem value="region">{t('Region')}</MenuItem>
        </TextField>
      </Stack>
      {(loading || recordsLoading) && <CircularProgress aria-label={t('Loading readiness')} />}
      {!loading && !recordsLoading && (
        <InventoryTable records={records} disabled={busy} onSelect={setSelectedId} />
      )}
      <Pagination
        aria-label={t('Inventory pages')}
        count={pageCount}
        page={currentPage}
        disabled={busy || loading || recordsLoading}
        onChange={(_, value) => setPage(value)}
      />
    </Stack>
  );
}
