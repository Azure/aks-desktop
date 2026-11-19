// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// The Review step of Setup: the configuration and the changes Create cluster makes to this
// computer. Create cluster is the first action that changes the computer; the CLI merges the
// cluster's context into the user's default kubeconfig and makes it the current context, so the
// page says so. Create cluster needs the accepted consent to match the latest checks. Inputs live
// in memory; a reload or a direct link returns to the environment step.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import { Link, Redirect, useHistory } from 'react-router-dom';
import { canCreate, currentConsent, setupStepAllowed } from '../../common/gates';
import { getSetupDraft, SetupDraft } from '../../common/setupDraft';
import { PLUGIN_ROUTES } from '../../contract/routes';
import { createLocalCluster } from '../../workflow/create';
import { getWorkflowState, WorkflowState } from '../../workflow/store';
import { TextRow } from '../shared/clusterText';
import { Card, DetailRows } from '../shared/DetailCard';
import { Translate } from '../shared/failureText';
import { useSetupDraft, useWorkflow } from '../shared/hooks';
import { InfoBanner } from '../shared/InfoBanner';
import { SetupFrame } from '../shared/SetupStepper';

/**
 * The CLI stops a create that has not finished after 30 minutes
 * (`aks-devctl/src/pkg/edgecore/create.go`, `operationTimeout`), so the page states that bound.
 */
const CREATE_UPPER_BOUND_MINUTES = 30;

function reviewRows(t: Translate, draft: SetupDraft, state: WorkflowState): TextRow[] {
  const option = state.versions?.find(entry => entry.version === draft.kubernetesVersion);
  return [
    { name: String(t('Cluster name')), value: draft.name },
    {
      name: String(t('Kubernetes version')),
      value: option === undefined ? '' : option.version,
    },
    {
      name: String(t('NVIDIA GPU')),
      value: draft.gpu ? String(t('Enabled')) : String(t('Not enabled')),
    },
    { name: String(t('Cluster size')), value: String(t('Single node')) },
    { name: String(t('Networking')), value: String(t('Cilium')) },
    { name: String(t('Runs on')), value: String(t('On-device')) },
    { name: String(t('Setup scope')), value: String(t('Your Windows account')) },
  ];
}

interface SetupAction {
  readonly icon: string;
  readonly title: string;
  readonly text: string;
}

/** What Create cluster does, in order. */
function setupActions(t: Translate): SetupAction[] {
  return [
    {
      icon: 'mdi:arrow-down',
      title: String(t('Install Ubuntu 24.04 in WSL 2')),
      text: String(t('Download and prepare the Linux environment for your local cluster.')),
    },
    {
      icon: 'mdi:server-outline',
      title: String(t('Install and start your Developer Cluster')),
      text: String(
        t(
          'Download required components and images, configure networking, and check cluster readiness.'
        )
      ),
    },
    {
      icon: 'mdi:plus',
      title: String(t('Add the cluster to AKS Desktop')),
      text: String(
        t(
          'Add its connection to your kubeconfig and make it the current context, so you can open the cluster alongside your other clusters and use it with kubectl. This does not register it with Azure.'
        )
      ),
    },
  ];
}

function SetupActions() {
  const { t } = useTranslation();
  return (
    <Card title={String(t('What setup will do'))} headingLevel="h3" headerFill>
      <Stack component="ol" spacing={2} sx={{ m: 0, p: 2, listStyle: 'none' }}>
        {setupActions(t).map((action, index) => (
          // Keyed by position: `t()` returns '' until the plugin's translations load.
          <Stack component="li" key={index} direction="row" spacing={1.5}>
            <Box sx={{ display: 'flex', pt: 0.25, color: 'primary.main' }}>
              <Icon icon={action.icon} width={18} height={18} />
            </Box>
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {action.title}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {action.text}
              </Typography>
            </Box>
          </Stack>
        ))}
      </Stack>
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{
          position: 'relative',
          px: 2,
          py: 1,
          borderTop: 1,
          borderColor: 'divider',
          color: 'success.main',
          '&::before': {
            content: '""',
            position: 'absolute',
            inset: 0,
            bgcolor: 'success.main',
            opacity: 0.08,
          },
        }}
      >
        <Icon icon="mdi:check" width={16} height={16} />
        <Typography variant="body2">
          {t('Installation permission confirmed in the Environment step.')}
        </Typography>
      </Stack>
    </Card>
  );
}

/**
 * The accepted consent no longer matches the latest checks, or the checks failed, including the
 * platform check. The environment step shows why and offers Check again. Other notices explain the
 * rest.
 */
function checksOutdated(draft: SetupDraft, state: WorkflowState): boolean {
  if (state.busy || state.target !== null) return false;
  return draft.consent !== currentConsent(state);
}

export function ReviewStep() {
  const { t } = useTranslation();
  const state = useWorkflow();
  const draft = useSetupDraft();
  const history = useHistory();

  if (!setupStepAllowed('review', draft, state)) {
    return <Redirect to={PLUGIN_ROUTES.environment} />;
  }

  // Re-checks the latest state: the click can follow an update that has not rendered yet.
  function create() {
    const current = getSetupDraft();
    const { kubernetesVersion } = current;
    if (kubernetesVersion === null || !canCreate(current, getWorkflowState())) return;
    createLocalCluster({ name: current.name, kubernetesVersion, gpu: current.gpu });
    // An accepted Create sets `createPhase` to running before its first await (create.ts).
    if (getWorkflowState().createPhase === 'running') history.push(PLUGIN_ROUTES.create);
  }

  return (
    <SetupFrame step="review" state={state}>
      <Typography variant="h5" component="h2" sx={{ fontWeight: 600 }}>
        {t('Review and create your Developer Cluster')}
      </Typography>
      {checksOutdated(draft, state) && (
        <Alert
          severity="warning"
          action={
            <Button color="inherit" size="small" component={Link} to={PLUGIN_ROUTES.environment}>
              {t('Review environment checks')}
            </Button>
          }
        >
          {t('The checks of this computer are no longer current. Review them again.')}
        </Alert>
      )}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'flex-start' }}>
        <Box sx={{ flex: '1 1 320px', minWidth: 0 }}>
          <Card
            title={String(t('Cluster settings'))}
            headingLevel="h3"
            headerFill
            action={
              // No minimum width, and the padding offset, so the text ends at the row values' edge.
              <Button
                size="small"
                component={Link}
                to={PLUGIN_ROUTES.configure}
                sx={{ minWidth: 0, px: 1, mr: -1 }}
              >
                {t('Edit')}
              </Button>
            }
          >
            <DetailRows rows={reviewRows(t, draft, state)} />
          </Card>
        </Box>
        <Box sx={{ flex: '1 1 320px', minWidth: 0 }}>
          {draft.consent !== null && <SetupActions />}
        </Box>
      </Box>
      <InfoBanner title={String(t('Keep Windows connected to the internet during setup.'))}>
        <Typography variant="body2" color="text.secondary">
          {t(
            'Follow progress as the environment and cluster are prepared. No Azure sign-in is required, and no Azure resources will be created.'
          )}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('Creating the cluster can take up to {{minutes}} minutes.', {
            minutes: CREATE_UPPER_BOUND_MINUTES,
          })}
        </Typography>
      </InfoBanner>
      <Stack direction="row" spacing={2} justifyContent="flex-end">
        <Button component={Link} to={PLUGIN_ROUTES.configure} variant="outlined">
          {t('Back')}
        </Button>
        <Button variant="contained" disabled={!canCreate(draft, state)} onClick={() => create()}>
          {t('Create cluster')}
        </Button>
      </Stack>
    </SetupFrame>
  );
}
