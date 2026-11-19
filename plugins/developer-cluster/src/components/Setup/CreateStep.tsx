// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// The Create step of Setup. While Create runs, including readiness polling, the page shows
// `Creating your Developer Cluster` with an indeterminate indicator and a first-run note. Success
// is reported only after readiness reports `usable`; the page then offers only Go to Overview. A
// timeout offers Check again. A failure is reported in one line that points to Overview, without a
// retry; Overview shows the failure sentence and may add that parts of the cluster can remain on
// this computer. A reload or a direct link returns to the environment step.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Alert, Stack } from '@mui/material';
import { Redirect } from 'react-router-dom';
import { setupStepAllowed } from '../../common/gates';
import { PLUGIN_ROUTES } from '../../contract/routes';
import { WorkflowFailure } from '../../workflow/failure';
import { WorkflowState } from '../../workflow/store';
import { CreateProgress } from '../shared/CreateProgress';
import { useSetupDraft, useWorkflow } from '../shared/hooks';
import { OverviewButton } from '../shared/OverviewButton';
import { SetupFrame } from '../shared/SetupStepper';
import { NotConfirmedNotice } from '../shared/WorkflowNotices';

/** The failure of a failed Create. */
function reportedFailure(state: WorkflowState): WorkflowFailure | null {
  return state.createPhase === 'failed' ? state.createFailure : null;
}

function CreateOutcome({ state }: { readonly state: WorkflowState }) {
  const { t } = useTranslation();
  const failure = reportedFailure(state);
  const succeeded = state.createPhase === 'usable' && state.target !== null;

  return (
    <Stack spacing={2}>
      {succeeded && <Alert severity="success">{t('Your Developer Cluster is ready.')}</Alert>}
      <NotConfirmedNotice state={state} />
      {failure !== null && (
        <Alert severity="error">
          {t(
            'Your Developer Cluster could not be created. Return to Overview to check the details.'
          )}
        </Alert>
      )}
      <Stack direction="row" spacing={2}>
        <OverviewButton variant={succeeded ? 'contained' : 'outlined'} />
      </Stack>
    </Stack>
  );
}

export function CreateStep() {
  const state = useWorkflow();
  const draft = useSetupDraft();

  if (!setupStepAllowed('create', draft, state)) {
    return <Redirect to={PLUGIN_ROUTES.environment} />;
  }

  return (
    <SetupFrame step="create" state={state}>
      {state.createPhase === 'running' ? <CreateProgress /> : <CreateOutcome state={state} />}
    </SetupFrame>
  );
}
