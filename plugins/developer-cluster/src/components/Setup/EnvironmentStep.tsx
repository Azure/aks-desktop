// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// The environment step of Setup: read-only checks of this computer and the explicit consent to
// install the WSL distribution. Next records the consent; nothing changes the computer before
// Create Cluster. Each check has one row, with the consent in the distro row. The distro row only
// says what Create installs: the CLI registers a new WSL 2 instance named after the cluster from
// the Ubuntu image and never uses a distribution the user installed. The plugin runs the platform
// checks itself: Windows x64 from the browser, WSL 2 from `wsl --status` and `reg query`. They run
// once per Setup attempt, when the step first opens without a result, and again only on Check
// again; Back from a later step reuses the result. Nothing else repeats them.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Loader } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Divider,
  FormControlLabel,
  Stack,
  Typography,
} from '@mui/material';
import { ReactNode, useEffect, useState } from 'react';
import { Link, useHistory } from 'react-router-dom';
import { canRefresh, currentConsent, environmentNextAllowed } from '../../common/gates';
import { acceptEnvironment, withdrawConsent } from '../../common/setupDraft';
import { ConsentKind, HostEnvironment } from '../../contract/capability';
import { LOCAL_DISTRO } from '../../contract/devctl';
import { PLUGIN_ROUTES } from '../../contract/routes';
import { EnvironmentBlocker, environmentBlockers } from '../../workflow/environment';
import { refreshSetup } from '../../workflow/setup';
import { getWorkflowState } from '../../workflow/store';
import { Translate } from '../shared/failureText';
import { useSetupDraft, useWorkflow } from '../shared/hooks';
import { OverviewButton } from '../shared/OverviewButton';
import { SetupFrame } from '../shared/SetupStepper';
import { RefreshFailureNotice } from '../shared/WorkflowNotices';

/** How a check row looks: `ready` passed, `info` is informational, `warning` needs attention. */
type CheckTone = 'ready' | 'info' | 'warning';

const TONE_ICON: Record<CheckTone, string> = {
  ready: 'mdi:check',
  info: 'mdi:information-outline',
  warning: 'mdi:alert-outline',
};

const TONE_COLOR: Record<CheckTone, string> = {
  ready: 'success.main',
  info: 'primary.main',
  warning: 'warning.main',
};

/** One row of the environment checks. */
interface Check {
  /** What is checked. */
  readonly name: string;
  /** The short result beside the name. */
  readonly status: string;
  /** The icon and color of the row. */
  readonly tone: CheckTone;
  /** A sentence below the name; absent for a row without one. */
  readonly description?: string;
}

/**
 * The Windows x64 check.
 *
 * @param t - The plugin's translate function.
 * @param windowsX64 - The platform check's answer: undefined before it, null if unknown.
 * @returns The row: checking, not verified, not supported or ready.
 */
function windowsCheck(t: Translate, windowsX64: boolean | null | undefined): Check {
  const name = String(t('Windows x64'));
  if (windowsX64 === undefined) return { name, status: String(t('Checking')), tone: 'info' };
  if (windowsX64 === null) return { name, status: String(t('Not verified')), tone: 'warning' };
  if (!windowsX64) {
    return {
      name,
      status: String(t('Not supported')),
      tone: 'warning',
      description: String(t('Developer Cluster requires 64-bit Windows on an x64 processor.')),
    };
  }
  return {
    name,
    status: String(t('Ready')),
    tone: 'ready',
    description: String(t('Supported operating system detected.')),
  };
}

/**
 * The WSL 2 check.
 *
 * @param t - The plugin's translate function.
 * @param environment - The environment step's last result.
 * @returns The row: ready, manual setup required or unknown.
 */
function wslCheck(t: Translate, environment: HostEnvironment): Check {
  const name = String(t('Windows Subsystem for Linux (WSL 2)'));
  if (environment.wsl === 'ready') {
    return {
      name,
      status: String(t('Ready')),
      tone: 'ready',
      description: String(
        t(
          'WSL 2 is installed and available. Your Developer Cluster will run in a Linux environment.'
        )
      ),
    };
  }
  if (environment.wsl === 'manual-setup-required') {
    return { name, status: String(t('Manual setup required')), tone: 'warning' };
  }
  return { name, status: String(t('Unknown')), tone: 'warning' };
}

/**
 * What Create installs; the CLI never uses a distribution the user installed.
 *
 * @param t - The plugin's translate function.
 * @returns The distro row, which always says installation is needed.
 */
function distroCheck(t: Translate): Check {
  return {
    name: LOCAL_DISTRO,
    status: String(t('Installation needed')),
    tone: 'info',
    description: String(
      t(
        'Developer Cluster will download {{distro}} during setup and install it as a new WSL 2 environment named after your cluster, then install the components needed to run your AKS cluster. No changes are made on this screen.',
        { distro: LOCAL_DISTRO }
      )
    ),
  };
}

/**
 * One row of the environment checks: an icon for its tone, the name, the status and an optional
 * description.
 *
 * @param props - The check, whether the row is first and optional content below it.
 * @returns A list item.
 */
function CheckRow({
  check,
  first,
  children,
}: {
  /** The check the row shows. */
  readonly check: Check;
  /** The first row has no top border. */
  readonly first?: boolean;
  /** Content below the description, such as the consent checkbox. */
  readonly children?: ReactNode;
}) {
  return (
    <Stack
      component="li"
      direction="row"
      spacing={1.5}
      sx={{ px: 2, py: 1.5, borderTop: first ? 0 : 1, borderColor: 'divider' }}
    >
      <Box aria-hidden sx={{ color: TONE_COLOR[check.tone], display: 'flex', pt: 0.25 }}>
        <Icon icon={TONE_ICON[check.tone]} width={18} height={18} />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" justifyContent="space-between" spacing={2}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {check.name}
          </Typography>
          <Typography variant="body2" sx={{ color: TONE_COLOR[check.tone], flexShrink: 0 }}>
            {check.status}
          </Typography>
        </Stack>
        {check.description !== undefined && (
          <Typography variant="body2" color="text.secondary">
            {check.description}
          </Typography>
        )}
        {children}
      </Box>
    </Stack>
  );
}

/**
 * The text for something that blocks Next.
 *
 * @param t - The plugin's translate function.
 * @param blocker - What blocks Next.
 * @returns The translated text that says what to do.
 */
function blockerText(t: Translate, blocker: EnvironmentBlocker): string {
  switch (blocker) {
    case 'wsl-manual-setup':
      return String(
        t('WSL 2 prerequisites are not ready. Complete the manual setup, then select Check again.')
      );
    case 'wsl-unknown':
      return String(
        t('AKS Desktop could not determine whether WSL 2 is ready. Select Check again.')
      );
    case 'target-registered':
      return String(t('A local cluster is already registered. Preview supports one cluster.'));
  }
}

/**
 * The label of the consent checkbox.
 *
 * @param t - The plugin's translate function.
 * @returns The translated consent text.
 */
function consentLabel(t: Translate): string {
  return String(
    t(
      'I agree to install Ubuntu 24.04 and the required Kubernetes components when I select Create cluster in the final step.'
    )
  );
}

/**
 * Everything that blocks Next, one notice each.
 *
 * @param props - `environment`, the environment step's last result.
 * @returns The notices; a registered cluster's notice links to Overview.
 */
function Blockers({ environment }: { readonly environment: HostEnvironment }) {
  const { t } = useTranslation();
  return (
    <>
      {environmentBlockers(environment).map(blocker => (
        <Alert
          key={blocker}
          severity={blocker === 'wsl-manual-setup' ? 'error' : 'warning'}
          action={blocker === 'target-registered' ? <OverviewButton /> : undefined}
        >
          {blockerText(t, blocker)}
        </Alert>
      ))}
    </>
  );
}

/**
 * The environment step route: the checks of this computer and the consent.
 *
 * @returns The step: the check rows once the checks succeed, the consent checkbox when they found
 * no blocker, the blockers, Back and Continue.
 */
export function EnvironmentStep() {
  const { t } = useTranslation();
  const state = useWorkflow();
  const draft = useSetupDraft();
  const history = useHistory();
  const [agreed, setAgreed] = useState<ConsentKind | null>(draft.consent);
  const { environment, refreshFailure, busy } = state;

  // Overview's Set up Developer Cluster clears the result (beginSetup); waits for a running
  // operation instead of being refused by it.
  useEffect(() => {
    if (environment === null && refreshFailure === null && !busy) refreshSetup();
  }, [environment, refreshFailure, busy]);

  const consent = currentConsent(state);

  /**
   * Updates the ticked consent; clearing it also withdraws an accepted consent.
   *
   * @param kind - The consent kind the checkbox stands for.
   * @param checked - Whether the checkbox is now ticked.
   */
  function changeConsent(kind: ConsentKind, checked: boolean) {
    if (checked) {
      setAgreed(kind);
      return;
    }
    setAgreed(null);
    withdrawConsent();
  }

  /**
   * Accepts the ticked consent and opens the configure step. Re-checks the latest state: the click
   * can follow an update that has not rendered yet.
   */
  function next() {
    if (agreed === null || !environmentNextAllowed(getWorkflowState(), agreed)) return;
    acceptEnvironment(agreed);
    history.push(PLUGIN_ROUTES.configure);
  }

  const checksShown = environment !== null && state.refreshFailure === null;

  return (
    <SetupFrame step="environment" state={state}>
      <Typography variant="h5" component="h2" sx={{ fontWeight: 600 }}>
        {t('Prepare your environment')}
      </Typography>
      <RefreshFailureNotice state={state} onCheckAgain={() => refreshSetup()} />
      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          spacing={2}
          sx={{ px: 2, py: 1, bgcolor: 'action.hover' }}
        >
          <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 600 }}>
            {t('Environment checks')}
          </Typography>
          <Stack direction="row" alignItems="center" spacing={2}>
            {checksShown && !state.busy && (
              <Typography variant="body2" color="success.main">
                {t('Checks complete')}
              </Typography>
            )}
            <Button size="small" disabled={!canRefresh(state)} onClick={() => refreshSetup()}>
              {t('Check again')}
            </Button>
          </Stack>
        </Stack>
        <Divider />
        {environment === null && state.busy && (
          <Box sx={{ p: 2 }}>
            <Loader title={String(t('Checking this computer'))} />
          </Box>
        )}
        {checksShown && (
          <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }}>
            <CheckRow check={windowsCheck(t, state.windowsX64)} first />
            <CheckRow check={wslCheck(t, environment)} />
            <CheckRow check={distroCheck(t)}>
              {consent !== null && (
                <Box sx={{ mt: 1.5, px: 1.5, py: 0.5, bgcolor: 'action.hover', borderRadius: 1 }}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        size="small"
                        checked={agreed === consent}
                        onChange={(_event, checked) => changeConsent(consent, checked)}
                      />
                    }
                    label={<Typography variant="body2">{consentLabel(t)}</Typography>}
                  />
                </Box>
              )}
            </CheckRow>
          </Box>
        )}
      </Box>
      {checksShown && <Blockers environment={environment} />}
      <Stack direction="row" spacing={2} justifyContent="flex-end">
        <Button component={Link} to={PLUGIN_ROUTES.overview} variant="outlined">
          {t('Back')}
        </Button>
        <Button
          variant="contained"
          endIcon={<Icon icon="mdi:arrow-right" />}
          disabled={!environmentNextAllowed(state, agreed)}
          onClick={() => next()}
        >
          {t('Continue')}
        </Button>
      </Stack>
    </SetupFrame>
  );
}
