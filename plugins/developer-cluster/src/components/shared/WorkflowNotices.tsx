// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// Notices shared by the Developer Cluster pages. A failed refresh and an unconfirmed readiness
// check replace no panel.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Alert, Button, Stack } from '@mui/material';
import { canCheckReadiness, canRefresh } from '../../common/gates';
import { checkReadinessAgain } from '../../workflow/create';
import { WorkflowState } from '../../workflow/store';
import { failureText } from './failureText';

interface NoticeProps {
  readonly state: WorkflowState;
}

interface RefreshFailureProps extends NoticeProps {
  readonly onCheckAgain: () => void;
}

/** The failure of the last refresh, with Check again. */
export function RefreshFailureNotice({ state, onCheckAgain }: RefreshFailureProps) {
  const { t } = useTranslation();
  if (state.refreshFailure === null) return null;
  return (
    <Alert
      severity="error"
      action={
        <Button
          color="inherit"
          size="small"
          disabled={!canRefresh(state)}
          onClick={() => onCheckAgain()}
        >
          {t('Check again')}
        </Button>
      }
    >
      {failureText(t, state.refreshFailure)}
    </Alert>
  );
}

/** Headlamp had not loaded the new context in time, or it could not be read. */
export function NotConfirmedNotice({ state }: NoticeProps) {
  const { t } = useTranslation();
  if (state.createPhase !== 'not-confirmed') return null;
  return (
    <Alert
      severity="warning"
      action={
        <Button
          color="inherit"
          size="small"
          disabled={!canCheckReadiness(state)}
          onClick={() => checkReadinessAgain()}
        >
          {t('Check again')}
        </Button>
      }
    >
      <Stack spacing={1}>
        <span>
          {t('The cluster was created, but AKS Desktop has not confirmed that it is usable.')}
        </span>
        {state.createFailure !== null && <span>{failureText(t, state.createFailure)}</span>}
      </Stack>
    </Alert>
  );
}
