// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  CircularProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import React, { useEffect, useState } from 'react';
import {
  type Cluster,
  type Insight,
  type InsightsProvider,
  scopeLabels,
  type UpgradeType,
} from '../../types/upgradeInsights';
import { errorMessage, formatTime, freshness, latestCombined, readiness, scopes } from './domain';
import GenerateInsight from './GenerateInsight';
import InsightScopeDetails from './InsightScopeDetails';
import { useSnapshotClock } from './useSnapshotClock';

const insightKey = (insight: Insight) => insight.id ?? insight.name;

export default function ClusterDetails({
  cluster,
  provider,
  refresh,
  onBusyChange,
  onGenerated,
}: {
  cluster: Cluster;
  provider: InsightsProvider;
  refresh: number;
  onBusyChange: (busy: boolean) => void;
  onGenerated: () => void;
}) {
  const { t } = useTranslation();
  useSnapshotClock();
  const [insights, setInsights] = useState<Insight[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [scope, setScope] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    provider
      .listInsights(cluster, controller.signal)
      .then(items => {
        if (controller.signal.aborted) return;
        setInsights(items);
        const preferred = latestCombined({ cluster, insights: items }) ?? items[0];
        setSelectedKey(previous =>
          items.some(i => insightKey(i) === previous)
            ? previous
            : preferred
            ? insightKey(preferred)
            : ''
        );
      })
      .catch(error => {
        if (!controller.signal.aborted) {
          setInsights([]);
          setError(errorMessage(error));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [provider, cluster, refresh]);

  const insight = insights.find(i => insightKey(i) === selectedKey);
  const selectedScopes = insight ? scopes(insight) : [];
  const effectiveScope = selectedScopes.some(s => s.name === scope) ? scope : '';
  const freshnessWarning = insight && freshness(insight, cluster);

  function generated(next: Insight) {
    setInsights(items => [next, ...items.filter(i => insightKey(i) !== insightKey(next))]);
    setSelectedKey(insightKey(next));
    setScope('');
    onGenerated();
  }

  return (
    <Stack spacing={2} sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
      <Typography variant="h5">
        {t('Cluster insights: {{name}}', { name: cluster.name })}
      </Typography>
      <Typography sx={{ overflowWrap: 'anywhere' }}>{cluster.id}</Typography>
      <Typography>
        {t('Current control plane: {{version}}', {
          version: cluster.kubernetesVersion ?? t('Unknown'),
        })}
      </Typography>
      {cluster.pools.map(pool => (
        <Typography key={pool.name}>
          {t('Current node pool {{name}}: Kubernetes {{version}}, node image {{image}}', {
            name: pool.name,
            version: pool.version ?? t('Unknown'),
            image: pool.nodeImageVersion ?? t('Unknown'),
          })}
        </Typography>
      ))}
      {cluster.poolInventoryKnown === false && (
        <Alert severity="warning">
          {t('Node pool inventory is incomplete. Combined readiness cannot be confirmed.')}
        </Alert>
      )}
      {loading && <CircularProgress aria-label={t('Loading stored insights')} />}
      {error && (
        <Alert severity="error">{t('Could not load stored insights: {{error}}', { error })}</Alert>
      )}
      {!loading && !error && !insights.length && (
        <Alert severity="info">
          {t(
            'No stored insights. Generate an evaluation after reviewing its exact scope and target.'
          )}
        </Alert>
      )}
      {!loading && !error && !!insights.length && (
        <TextField
          select
          label={t('Stored evaluation')}
          value={insight ? selectedKey : ''}
          disabled={busy}
          onChange={event => {
            setSelectedKey(event.target.value);
            setScope('');
          }}
        >
          {insights.map(item => (
            <MenuItem key={insightKey(item)} value={insightKey(item)}>
              {`${item.name} — ${t(
                scopeLabels[item.properties.upgradeType as UpgradeType] ?? 'Unknown scope'
              )} — ${
                item.properties.targetKubernetesVersion ??
                item.properties.targetNodeImageVersion ??
                t('Unknown target')
              }`}
            </MenuItem>
          ))}
        </TextField>
      )}
      {!loading && insight && (
        <>
          <Typography variant="h6">
            {t('Stored readiness: {{status}}', { status: t(readiness(insight, cluster)) })}
          </Typography>
          <Typography>
            {t('Last evaluated: {{time}}', {
              time: formatTime(insight.properties.lastEvaluatedAt) ?? t('Not available'),
            })}
          </Typography>
          <Typography>
            {t('Expires: {{time}}', {
              time: formatTime(insight.properties.expiresAt) ?? t('Not available'),
            })}
          </Typography>
          {insight.properties.upgradeType === 'NodeImage' ? (
            <Typography>
              {t('Evaluated node image: {{source}}. Target node image: {{target}}.', {
                source: insight.properties.currentNodeImageVersion ?? t('Unknown'),
                target: insight.properties.targetNodeImageVersion ?? t('Unknown'),
              })}
            </Typography>
          ) : (
            <Typography>
              {t('Target Kubernetes version: {{version}}', {
                version: insight.properties.targetKubernetesVersion ?? t('Unknown'),
              })}
            </Typography>
          )}
          {freshnessWarning && <Alert severity="warning">{t(freshnessWarning)}</Alert>}
          <TextField
            select
            label={t('Evaluation scope')}
            value={effectiveScope}
            SelectProps={{ displayEmpty: true }}
            InputLabelProps={{ shrink: true }}
            disabled={busy}
            onChange={event => setScope(event.target.value)}
          >
            <MenuItem value="">{t('All evaluated scopes')}</MenuItem>
            {selectedScopes.map(({ name }) => (
              <MenuItem key={name} value={name}>
                {['Control plane', 'Unnamed pool'].includes(name) ? t(name) : name}
              </MenuItem>
            ))}
          </TextField>
          {selectedScopes
            .filter(s => !effectiveScope || s.name === effectiveScope)
            .map(({ name, result }) => (
              <InsightScopeDetails key={name} name={name} result={result} />
            ))}
          <Accordion>
            <AccordionSummary>{t('Raw API response')}</AccordionSummary>
            <AccordionDetails>
              <Box component="pre" sx={{ overflow: 'auto', maxHeight: 450 }}>
                {JSON.stringify(insight, null, 2)}
              </Box>
            </AccordionDetails>
          </Accordion>
        </>
      )}
      <GenerateInsight
        cluster={cluster}
        provider={provider}
        onGenerated={generated}
        onBusyChange={value => {
          setBusy(value);
          onBusyChange(value);
        }}
      />
    </Stack>
  );
}
