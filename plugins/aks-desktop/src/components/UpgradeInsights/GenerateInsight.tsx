// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';
import {
  API_VERSION,
  type Cluster,
  type GenerateRequest,
  type Insight,
  type InsightsProvider,
  scopeLabels,
  type UpgradeType,
} from '../../types/upgradeInsights';
import { errorMessage } from './domain';

/** Confirmed evaluation writes for one explicitly selected ARM cluster. */
export interface GenerateInsightProps {
  /** Cluster identity and pool inventory constraining the generation scope. */
  cluster: Cluster;
  /** Authenticated provider that stores and verifies the requested evaluation. */
  provider: InsightsProvider;
  /**
   * Receive a generated resource only after its exact stored-resource GET has been verified.
   * @param insight Verified stored evaluation, not an upgrade execution result.
   * @returns No value.
   */
  onGenerated: (insight: Insight) => void;
  /**
   * Coordinate edit locks with the owning page while generation is active.
   * @param busy Whether submission and verification are in flight.
   * @returns No value.
   */
  onBusyChange: (busy: boolean) => void;
}

/**
 * Discover scope-specific targets and require review of the exact insight-generating POST.
 * @param props Cluster/provider binding and generation lifecycle callbacks.
 * @returns Scope and target inputs, explicit write confirmation, and progress or verification errors.
 */
export default function GenerateInsight({
  cluster,
  provider,
  onGenerated,
  onBusyChange,
}: GenerateInsightProps) {
  const { t } = useTranslation();
  const [scope, setScope] = useState<UpgradeType>('ControlPlaneAndAgentPools');
  const [pool, setPool] = useState('');
  const [target, setTarget] = useState('');
  const [nodeImage, setNodeImage] = useState('');
  const [targets, setTargets] = useState<string[]>([]);
  const [loadingTargets, setLoadingTargets] = useState(false);
  const [targetError, setTargetError] = useState('');
  const [retry, setRetry] = useState(0);
  const [pending, setPending] = useState<GenerateRequest>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const submission = useRef<AbortController | undefined>(undefined);
  const callbacks = useRef({ onGenerated, onBusyChange });
  callbacks.current = { onGenerated, onBusyChange };
  const needsPool = scope === 'AgentPool' || scope === 'NodeImage';

  useEffect(() => {
    const controller = new AbortController();
    setTargets([]);
    setTarget('');
    setTargetError('');
    setLoadingTargets(false);
    // Node image evaluation has no Kubernetes target dependency.
    if (scope === 'NodeImage' || (scope === 'AgentPool' && !pool)) return;
    setLoadingTargets(true);
    provider
      .listUpgradeTargets(
        cluster,
        scope === 'AgentPool'
          ? { upgradeType: scope, agentPoolName: pool }
          : { upgradeType: scope },
        controller.signal
      )
      .then(items => {
        if (!controller.signal.aborted) setTargets(items);
      })
      .catch(error => {
        if (!controller.signal.aborted) setTargetError(errorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingTargets(false);
      });
    return () => controller.abort();
  }, [provider, cluster, scope, pool, retry]);

  useEffect(() => () => submission.current?.abort(), [provider, cluster.id]);

  /**
   * Build only a valid request for the current inputs, without writing or starting an upgrade.
   * @returns A reviewable body, or undefined until the pool and scope-specific target are valid.
   */
  function buildRequest(): GenerateRequest | undefined {
    if (needsPool && !cluster.pools.some(p => p.name === pool)) return;
    if (scope === 'NodeImage') {
      return {
        upgradeType: 'NodeImage',
        agentPoolName: pool,
        ...(nodeImage.trim() ? { targetNodeImageVersion: nodeImage.trim() } : {}),
      };
    }
    if (!target || !targets.includes(target) || loadingTargets || targetError) return;
    return scope === 'AgentPool'
      ? { upgradeType: scope, agentPoolName: pool, targetKubernetesVersion: target }
      : { upgradeType: scope, targetKubernetesVersion: target };
  }

  /**
   * Submit the confirmed body once, ignoring responses after the owning session is cancelled.
   * @returns A promise that settles after submission/verification handling; errors remain in the UI.
   */
  async function generate() {
    if (!pending || submission.current) return;
    const controller = new AbortController();
    submission.current = controller;
    setSubmitting(true);
    callbacks.current.onBusyChange(true);
    setError('');
    try {
      const verified = await provider.generate(cluster, pending, controller.signal);
      if (!controller.signal.aborted) {
        callbacks.current.onGenerated(verified);
        setPending(undefined);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setError(errorMessage(error));
        setPending(undefined);
      }
    } finally {
      if (!controller.signal.aborted) {
        submission.current = undefined;
        setSubmitting(false);
        callbacks.current.onBusyChange(false);
      }
    }
  }

  return (
    <Stack spacing={2}>
      <Typography variant="h6">{t('Generate a stored evaluation')}</Typography>
      <Typography>
        {t(
          'Generating does not perform an upgrade, apply remediation, or register Azure features.'
        )}
      </Typography>
      {error && (
        <Alert severity="error">
          {t(
            'Evaluation was not verified: {{error}}. The request may already have stored an insight; refresh before retrying.',
            { error }
          )}
        </Alert>
      )}
      <TextField
        select
        label={t('Generate scope')}
        value={scope}
        disabled={submitting || !!pending}
        onChange={event => {
          setScope(event.target.value as UpgradeType);
          setError('');
        }}
      >
        {(Object.keys(scopeLabels) as UpgradeType[]).map(value => (
          <MenuItem key={value} value={value}>
            {t(scopeLabels[value])}
          </MenuItem>
        ))}
      </TextField>
      {needsPool && (
        <TextField
          select
          label={t('Node pool')}
          value={pool}
          disabled={submitting || !!pending}
          onChange={event => setPool(event.target.value)}
        >
          <MenuItem value="">{t('Select a node pool')}</MenuItem>
          {cluster.pools.map(pool => (
            <MenuItem key={pool.name} value={pool.name}>
              {pool.name}
            </MenuItem>
          ))}
        </TextField>
      )}
      {scope === 'NodeImage' ? (
        <TextField
          label={t('Target node image version (optional)')}
          value={nodeImage}
          disabled={submitting || !!pending}
          onChange={event => setNodeImage(event.target.value)}
          helperText={t(
            'Leave empty to ask Azure to evaluate the latest available node image. No Kubernetes target is sent.'
          )}
        />
      ) : (
        <>
          {loadingTargets && <CircularProgress aria-label={t('Loading upgrade targets')} />}
          {targetError && (
            <Alert
              severity="error"
              action={
                <Button disabled={submitting || !!pending} onClick={() => setRetry(n => n + 1)}>
                  {t('Retry targets')}
                </Button>
              }
            >
              {t('Could not load upgrade targets: {{error}}', { error: targetError })}
            </Alert>
          )}
          {!loadingTargets && !targetError && !targets.length && (!needsPool || pool) && (
            <Alert severity="info">
              {t('No supported Kubernetes targets were returned for this scope.')}
            </Alert>
          )}
          <TextField
            select
            label={t('Target Kubernetes version')}
            value={target}
            disabled={submitting || !!pending || loadingTargets || !!targetError}
            onChange={event => setTarget(event.target.value)}
          >
            <MenuItem value="">{t('Select an API-supported target')}</MenuItem>
            {targets.map(version => (
              <MenuItem key={version} value={version}>
                {version}
              </MenuItem>
            ))}
          </TextField>
        </>
      )}
      <Button
        variant="outlined"
        disabled={submitting || !!pending || !buildRequest()}
        onClick={() => setPending(buildRequest())}
      >
        {t('Review generation request')}
      </Button>
      <Dialog
        open={!!pending}
        fullWidth
        maxWidth="md"
        onClose={() => {
          if (!submitting) setPending(undefined);
        }}
        aria-labelledby="upgrade-insights-confirm-title"
      >
        <DialogTitle id="upgrade-insights-confirm-title">
          {t('Confirm stored evaluation generation')}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <Alert severity="warning">
              {t(
                'This POST writes or replaces a stored Upgrade Insights resource in Azure. It does not upgrade the cluster. Review the exact cluster, scope, and target before continuing.'
              )}
            </Alert>
            <Typography>{t('Cluster: {{id}}', { id: cluster.id })}</Typography>
            <Typography>
              {t('Scope: {{scope}}', { scope: pending ? t(scopeLabels[pending.upgradeType]) : '' })}
            </Typography>
            {pending?.upgradeType === 'NodeImage' && !pending.targetNodeImageVersion && (
              <Typography>
                {t('Target: latest available node image, selected by Azure.')}
              </Typography>
            )}
            <Box
              component="pre"
              sx={{ overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
            >
              {`POST ${
                cluster.id
              }/generateUpgradeInsights?api-version=${API_VERSION}\n${JSON.stringify(
                pending,
                null,
                2
              )}`}
            </Box>
            {submitting && (
              <Typography role="status">
                {t('Generating and verifying the stored insight. Do not submit again.')}
              </Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={submitting} onClick={() => setPending(undefined)}>
            {t('Cancel')}
          </Button>
          <Button variant="contained" disabled={submitting} onClick={generate}>
            {t('Confirm POST and generate')}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
