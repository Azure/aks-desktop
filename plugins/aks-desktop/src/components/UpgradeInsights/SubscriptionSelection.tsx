// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  Alert,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  Stack,
  Typography,
} from '@mui/material';
import React from 'react';
import type { UpgradeInsightSubscription } from '../../utils/azure/upgrade-insights';

/** Controlled subscription inputs, independent of discovery and provider creation. */
export interface SubscriptionSelectionProps {
  /** Enabled subscriptions discovered for the current authenticated account. */
  subscriptions: UpgradeInsightSubscription[];
  /** Explicit selections, not the Azure CLI's default subscription. */
  selectedIds: string[];
  /** Whether subscription enumeration is pending. */
  loading: boolean;
  /** Discovery failure, empty when the request has not failed. */
  error: string;
  /** Lock edits while generation is in flight. */
  busy: boolean;
  /** Whether the selection differs from the currently applied provider scope. */
  selectionChanged: boolean;
  /** Update the session's explicit selection without creating a provider. */
  onSelectionChange: (ids: string[]) => void;
  /** Retry failed subscription discovery. */
  onRetry: () => void;
  /** Apply the explicit selection and create its session-owned provider. */
  onApply: () => void;
}

/**
 * Display subscription discovery and selection without making Azure requests.
 * @param props Session-owned discovery state, selection, and event callbacks.
 * @returns Selection controls, loading/empty/error feedback, and the explicit apply action.
 */
export default function SubscriptionSelection({
  subscriptions,
  selectedIds,
  loading,
  error,
  busy,
  selectionChanged,
  onSelectionChange,
  onRetry,
  onApply,
}: SubscriptionSelectionProps) {
  const { t } = useTranslation();
  return (
    <>
      <Typography variant="h6">{t('Choose subscriptions')}</Typography>
      <Typography variant="body2">
        {t(
          'Only explicitly selected subscriptions are queried. No Kubernetes context is required.'
        )}
      </Typography>
      {loading && <CircularProgress aria-label={t('Loading subscriptions')} />}
      {error && (
        <Alert severity="error" action={<Button onClick={onRetry}>{t('Retry')}</Button>}>
          {t('Could not load subscriptions: {{error}}', { error })}
        </Alert>
      )}
      {!loading && !error && !subscriptions.length && (
        <Alert severity="warning">{t('No enabled Azure subscriptions are available.')}</Alert>
      )}
      <Stack direction="row" flexWrap="wrap">
        {subscriptions.map(subscription => (
          <FormControlLabel
            key={subscription.id}
            control={
              <Checkbox
                disabled={busy}
                checked={selectedIds.includes(subscription.id)}
                onChange={(_, checked) =>
                  onSelectionChange(
                    checked
                      ? [...selectedIds, subscription.id]
                      : selectedIds.filter(id => id !== subscription.id)
                  )
                }
              />
            }
            label={`${subscription.name} (${subscription.id})`}
          />
        ))}
      </Stack>
      <Button
        variant="contained"
        disabled={busy || loading || !selectedIds.length || !selectionChanged}
        onClick={onApply}
      >
        {t('Load selected subscriptions')}
      </Button>
    </>
  );
}
