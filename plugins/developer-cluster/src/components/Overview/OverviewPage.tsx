// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// Overview. Without a cluster it is the landing page: readiness, one next action (Set up Developer
// Cluster), the guided path and what setup needs. While Create or Delete runs, it shows the one
// panel of overviewPanel instead. Opening Overview refreshes it; opened while another operation
// runs, it refreshes when that operation ends unless a refresh finished meanwhile.
// After a failed Create without a local cluster in the kubeconfig, the landing page shows the
// failure and says that parts of the cluster can remain on this computer; after a failed Delete it
// shows that failure. Overview reads only the kubeconfig target; the platform checks run in Setup's
// environment step. With a cluster it shows the cluster with its Status and View, the cluster
// details, and Delete with its result. While Delete runs, the panel shows only its progress and how
// long it can take.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Loader, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Alert, Box, Breadcrumbs, Button, Chip, Divider, Stack, Typography } from '@mui/material';
import { ReactNode } from 'react';
import { Link, useHistory } from 'react-router-dom';
import landingIllustration from '../../assets/landing-illustration.png';
import { canOpenCluster, canRefresh } from '../../common/gates';
import { overviewPanel } from '../../common/panel';
import { LocalTarget } from '../../contract/capability';
import { LOCAL_DISTRO, LOCAL_NODE_COUNT } from '../../contract/devctl';
import { clusterRoute, PLUGIN_ROUTES, PRODUCT_DISPLAY_NAME } from '../../contract/routes';
import { beginSetup, refreshOverview } from '../../workflow/setup';
import { WorkflowState } from '../../workflow/store';
import {
  DeleteButtonSection,
  DeleteFailureNotice,
  DeleteProgress,
  DeleteResultNotice,
} from '../Cluster/DeleteSection';
import { TextRow } from '../shared/clusterText';
import { CreateProgress } from '../shared/CreateProgress';
import { Card, DetailRows } from '../shared/DetailCard';
import { failureText } from '../shared/failureText';
import {
  ApiServerStatus,
  useApiServerStatus,
  useOverviewRefresh,
  useWorkflow,
} from '../shared/hooks';
import { NotConfirmedNotice, RefreshFailureNotice } from '../shared/WorkflowNotices';

interface StateProps {
  readonly state: WorkflowState;
}

/** The readiness notice; without `ready` there is no success banner. */
function Readiness({ state, ready }: StateProps & { readonly ready?: ReactNode }) {
  if (state.refreshFailure !== null) {
    return <RefreshFailureNotice state={state} onCheckAgain={() => refreshOverview()} />;
  }
  if (ready === undefined) return null;
  return <Alert severity="success">{ready}</Alert>;
}

function Requirements() {
  const { t } = useTranslation();
  return (
    <Stack spacing={1}>
      <Typography>
        {t(
          'Developer Cluster creates a single-node Kubernetes cluster on this computer. It needs:'
        )}
      </Typography>
      <Box component="ul" sx={{ m: 0, pl: 3 }}>
        <li>
          {t('Windows with WSL 2 and the {{distro}} WSL distribution', { distro: LOCAL_DISTRO })}
        </li>
        <li>{t('Processors and memory of this computer, shared with WSL')}</li>
      </Box>
      <Typography>{t('Azure sign-in is not required.')}</Typography>
    </Stack>
  );
}

function ClusterPanel({ state }: StateProps) {
  switch (overviewPanel(state)) {
    case 'creating':
      return <CreateProgress />;
    case 'deleting':
      return <DeleteProgress />;
    case 'loading':
    case 'target':
    case 'none':
      // OverviewPage renders these with ClusterOverview and Landing instead.
      return null;
  }
}

/** A square tag beside a page title. */
function TitleTag({ label }: { readonly label: string }) {
  return <Chip label={label} size="small" sx={{ borderRadius: 1 }} />;
}

function CreateFailureNotice({ state }: StateProps) {
  const { t } = useTranslation();
  if (state.createPhase !== 'failed' || state.createFailure === null) return null;
  return (
    <Alert severity="error">
      <Stack spacing={1}>
        <span>{t('Your Developer Cluster could not be created.')}</span>
        <span>{failureText(t, state.createFailure)}</span>
        <span>
          {t(
            'Parts of the cluster, such as its WSL instance, can remain on this computer. Developer Cluster does not remove them.'
          )}
        </span>
      </Stack>
    </Alert>
  );
}

/**
 * The decorative landing illustration, a container with a code symbol.
 * The build inlines the PNG into main.js; it is 440 px wide for high-density displays.
 */
function LandingIllustration() {
  return (
    <Box
      component="img"
      src={landingIllustration}
      alt=""
      aria-hidden
      sx={{ display: 'block', width: 220, maxWidth: '100%', height: 'auto' }}
    />
  );
}

/** The landing page without a cluster. */
function Landing({ state }: StateProps) {
  const { t } = useTranslation();
  const history = useHistory();
  const steps = [
    {
      title: t('Prepare your environment'),
      text: t('Check system prerequisites and review anything that needs to be installed.'),
    },
    {
      title: t('Create your cluster'),
      text: t('Choose your configuration and follow progress as your Developer Cluster starts.'),
    },
    {
      title: t('Deploy your first app'),
      text: t('Run an application on your cluster, then explore its workloads, logs, and events.'),
    },
  ];
  return (
    <Stack spacing={3}>
      <Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="h4" component="h1">
            {PRODUCT_DISPLAY_NAME}
          </Typography>
          <TitleTag label={String(t('Preview'))} />
        </Stack>
        <Typography color="text.secondary">
          {t('Your AKS development environment, right here in AKS Desktop.')}
        </Typography>
      </Box>
      <NotConfirmedNotice state={state} />
      <Readiness
        state={state}
        ready={
          <>
            <strong>{t('Plugin installed.')}</strong>{' '}
            {t("You're ready to set up Developer Cluster.")}
          </>
        }
      />
      <DeleteResultNotice state={state} />
      <DeleteFailureNotice state={state} />
      <CreateFailureNotice state={state} />
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
          overflow: 'hidden',
        }}
      >
        <Stack spacing={2} alignItems="flex-start" sx={{ flex: '3 1 320px', p: 3 }}>
          <Box
            aria-hidden
            sx={{
              position: 'relative',
              display: 'flex',
              p: 1,
              borderRadius: 1,
              color: 'primary.main',
              '&::before': {
                content: '""',
                position: 'absolute',
                inset: 0,
                borderRadius: 1,
                bgcolor: 'primary.main',
                opacity: 0.12,
              },
            }}
          >
            <Icon icon="mdi:laptop" width={24} height={24} />
          </Box>
          <Typography variant="h5" component="h2" sx={{ fontWeight: 600 }}>
            {t('Your workspace for Kubernetes development.')}
          </Typography>
          <Typography color="text.secondary">
            {t(
              'Create a Kubernetes cluster to build and test applications locally. Deploy workloads, inspect logs, and troubleshoot—all from AKS Desktop.'
            )}
          </Typography>
          <Button
            variant="contained"
            endIcon={<Icon icon="mdi:arrow-right" />}
            disabled={!canRefresh(state)}
            onClick={() => {
              beginSetup();
              history.push(PLUGIN_ROUTES.environment);
            }}
          >
            {t('Set up Developer Cluster')}
          </Button>
          <Typography variant="body2" color="text.secondary">
            {t('No Azure account or Azure subscription required.')}
          </Typography>
        </Stack>
        <Stack
          spacing={2}
          alignItems="center"
          justifyContent="center"
          sx={{ flex: '2 1 240px', p: 3, bgcolor: 'action.hover' }}
        >
          <LandingIllustration />
          <Typography variant="body2" color="text.secondary">
            {t('Build locally. Explore with AKS Desktop.')}
          </Typography>
        </Stack>
      </Box>
      <Stack spacing={2}>
        <Typography variant="h6" component="h2" sx={{ fontWeight: 600 }}>
          {t('A guided path to your first running app')}
        </Typography>
        <Box
          component="ol"
          sx={{ display: 'flex', flexWrap: 'wrap', gap: 3, m: 0, p: 0, listStyle: 'none' }}
        >
          {steps.map((step, index) => (
            // Keyed by position: `t()` returns '' until the plugin's translations load.
            <Stack
              component="li"
              key={index}
              direction="row"
              spacing={1.5}
              sx={{ flex: '1 1 200px' }}
            >
              <Box
                aria-hidden
                sx={{
                  width: 24,
                  height: 24,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '50%',
                  bgcolor: 'action.hover',
                  typography: 'caption',
                }}
              >
                {index + 1}
              </Box>
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {step.title}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {step.text}
                </Typography>
              </Box>
            </Stack>
          ))}
        </Box>
      </Stack>
      <Divider />
      <Stack direction="row" spacing={1.5}>
        <Box aria-hidden sx={{ color: 'text.secondary', display: 'flex', pt: 0.25 }}>
          <Icon icon="mdi:information-outline" width={18} height={18} />
        </Box>
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {t('Before you begin')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t(
              "This preview requires Windows, WSL 2, and Ubuntu 24.04. Setup requires an internet connection and uses system CPU, memory, and disk resources. You'll see any required changes before you proceed. Installing the plugin does not create a cluster."
            )}
          </Typography>
        </Box>
      </Stack>
    </Stack>
  );
}

function StatusValue({ status }: { readonly status: ApiServerStatus }) {
  const { t } = useTranslation();
  switch (status) {
    case 'checking':
      return <Typography>{t('Checking')}</Typography>;
    case 'active':
      return <Typography color="success.main">{t('Active')}</Typography>;
    case 'unreachable':
      return <Typography color="error.main">{t('Not reachable')}</Typography>;
  }
}

function SummaryField({ label, value }: { readonly label: string; readonly value: ReactNode }) {
  return (
    <Box sx={{ flex: '1 1 0', minWidth: 140 }}>
      <Typography component="dt" variant="body2" sx={{ fontWeight: 600 }}>
        {label}
      </Typography>
      <Box component="dd" sx={{ m: 0 }}>
        {value}
      </Box>
    </Box>
  );
}

interface ClusterProps extends StateProps {
  readonly target: Readonly<LocalTarget>;
}

/**
 * View opens the cluster in AKS Desktop. It is enabled once readiness reported `usable` in this
 * session or the API server answers `/readyz`.
 */
function ViewButton({
  state,
  target,
  status,
}: ClusterProps & { readonly status: ApiServerStatus }) {
  const { t } = useTranslation();
  const enabled = canOpenCluster(state) || status === 'active';
  return (
    <Button
      component={Link}
      to={clusterRoute(target.listName)}
      variant="contained"
      disabled={!enabled}
    >
      {t('View')}
    </Button>
  );
}

/** The cluster layout: no tabs, metrics or events, and no Stop or Edit. */
function ClusterOverview({ state, target }: ClusterProps) {
  const { t } = useTranslation();
  const status = useApiServerStatus(target.listName);
  const unknown = String(t('Unknown'));
  const version = target.kubernetesVersion ?? unknown;
  const details: TextRow[] = [
    { name: String(t('Kubernetes version')), value: version },
    { name: String(t('Environment')), value: target.image ?? unknown },
    { name: String(t('Networking')), value: String(t('Cilium')) },
    { name: String(t('Azure registration')), value: String(t('Not connected to Azure')) },
  ];
  return (
    <Stack spacing={3}>
      <Breadcrumbs aria-label={String(t('Breadcrumb'))}>
        <Typography color="text.secondary">{PRODUCT_DISPLAY_NAME}</Typography>
        <Typography color="text.primary">{target.name}</Typography>
      </Breadcrumbs>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="h4" component="h1">
          {target.name}
        </Typography>
        <TitleTag label={String(t('On-device'))} />
      </Stack>
      <Readiness state={state} />
      <Card
        title={String(t('Cluster'))}
        action={<ViewButton state={state} target={target} status={status} />}
      >
        <Box component="dl" sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, m: 0, p: 2 }}>
          <SummaryField label={String(t('Status'))} value={<StatusValue status={status} />} />
          <SummaryField
            label={String(t('Cluster type'))}
            value={<Typography>{PRODUCT_DISPLAY_NAME}</Typography>}
          />
          <SummaryField
            label={String(t('Nodes'))}
            value={<Typography>{String(LOCAL_NODE_COUNT)}</Typography>}
          />
          <SummaryField
            label={String(t('Kubernetes version'))}
            value={<Typography>{version}</Typography>}
          />
        </Box>
      </Card>
      <NotConfirmedNotice state={state} />
      <Card title={String(t('Cluster details'))}>
        <DetailRows rows={details} />
      </Card>
      <DeleteButtonSection
        key={`${target.name}:${target.kubernetesVersion}:${target.contextName}`}
        state={state}
        target={target}
      />
    </Stack>
  );
}

export function OverviewPage() {
  const { t } = useTranslation();
  const state = useWorkflow();
  useOverviewRefresh(state.busy);
  const { target } = state;
  const panel = overviewPanel(state);
  if (panel === 'target' && target !== null) {
    return (
      <Box sx={{ p: 3, maxWidth: 960, mx: 'auto' }}>
        <ClusterOverview state={state} target={target} />
      </Box>
    );
  }
  if (panel === 'none') {
    return (
      <Box sx={{ p: 3, maxWidth: 960, mx: 'auto' }}>
        <Landing state={state} />
      </Box>
    );
  }
  if (panel === 'loading') {
    return (
      <Box sx={{ p: 3, maxWidth: 960, mx: 'auto' }}>
        <Loader title={String(t('Checking Developer Cluster'))} />
      </Box>
    );
  }
  const deleting = panel === 'deleting';
  return (
    <Box sx={{ p: 3, maxWidth: 960, mx: 'auto' }}>
      <SectionBox title={PRODUCT_DISPLAY_NAME}>
        <Stack spacing={3}>
          {!deleting && (
            <Readiness state={state} ready={t('Developer Cluster is installed and ready.')} />
          )}
          {!deleting && <Requirements />}
          <ClusterPanel state={state} />
        </Stack>
      </SectionBox>
    </Box>
  );
}
