// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// The Configure step of Setup: the cluster name, pre-filled with a default, a Kubernetes version
// taken only from `cluster get-versions`, and an optional NVIDIA GPU checkbox with its
// requirements. The distribution determines the networking default. Preview
// supports one cluster: while one is registered, Next stays disabled, and the Setup frame shows
// Overview instead. Inputs live in memory; a reload or a direct link returns to the environment
// step. Nothing changes the computer here.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { ReactNode, useState } from 'react';
import { Link, Redirect, useHistory } from 'react-router-dom';
import { KubernetesVersionOption } from '../../cli/commands';
import { configurationValid, setupStepAllowed, versionAvailable } from '../../common/gates';
import { configureCluster, getSetupDraft } from '../../common/setupDraft';
import {
  CLUSTER_NAME_MAX_LENGTH,
  ClusterNameProblem,
  clusterNameProblem,
} from '../../contract/clusterName';
import { isKubernetesDistribution, KubernetesDistribution } from '../../contract/devctl';
import { PLUGIN_ROUTES } from '../../contract/routes';
import { defaultKubernetesVersion } from '../../workflow/setup';
import { getWorkflowState } from '../../workflow/store';
import { networkingText, TextRow } from '../shared/clusterText';
import { Card, DetailRows } from '../shared/DetailCard';
import { Translate } from '../shared/failureText';
import { useSetupDraft, useWorkflow } from '../shared/hooks';
import { InfoBanner } from '../shared/InfoBanner';
import { SetupFrame } from '../shared/SetupStepper';

const NAME_ID = 'developer-cluster-cluster-name';
const VERSION_LABEL_ID = 'developer-cluster-kubernetes-version-label';
const DISTRIBUTION_LABEL_ID = 'developer-cluster-distribution-label';
const GPU_LABEL_ID = 'developer-cluster-gpu-label';
const GPU_REQUIREMENTS_ID = 'developer-cluster-gpu-requirements';

/**
 * The text for a cluster name problem.
 *
 * @param t - The plugin's translate function.
 * @param problem - The first rule the name breaks.
 * @returns The translated text that says how to fix the name.
 */
function nameProblemText(t: Translate, problem: ClusterNameProblem): string {
  if (problem === 'required') return String(t('Enter a cluster name.'));
  if (problem === 'too-long') {
    return String(t('Use at most {{max}} characters.', { max: CLUSTER_NAME_MAX_LENGTH }));
  }
  if (problem === 'characters') {
    return String(t('Use only lowercase letters, digits and hyphens.'));
  }
  return String(t('Start and end with a lowercase letter or digit.'));
}

/**
 * The text of a catalog entry in the version list. The catalog has no duplicate Kubernetes versions
 * (commands.ts), so the version names an entry. The preselected entry is marked recommended.
 *
 * @param t - The plugin's translate function.
 * @param option - The catalog entry.
 * @param recommended - Whether the entry is the preselected default.
 * @returns The version, marked deprecated or recommended where that applies.
 */
function versionText(t: Translate, option: KubernetesVersionOption, recommended: boolean): string {
  const { version } = option;
  if (option.deprecated) return String(t('{{version}} (deprecated)', { version }));
  if (recommended) return String(t('{{version}} (Recommended)', { version }));
  return version;
}

/**
 * The read-only environment of a new cluster.
 *
 * @param t - The plugin's translate function.
 * @returns The rows of the Runtime environment card.
 */
function environmentRows(t: Translate, distribution: KubernetesDistribution): TextRow[] {
  return [
    { name: String(t('Runs on')), value: String(t('On-device')) },
    { name: String(t('Environment')), value: String(t('WSL 2 / Ubuntu 24.04')) },
    { name: String(t('Cluster size')), value: String(t('Single node')) },
    { name: String(t('Networking')), value: networkingText(t, distribution) },
  ];
}

/**
 * A label above its input, with a red mark when the input is required.
 *
 * @param props - The label's target, id, required flag and text.
 * @returns A `label` element.
 */
function FieldLabel({
  htmlFor,
  id,
  required = true,
  children,
}: {
  /** The id of the input the label belongs to. */
  readonly htmlFor?: string;
  /** The label's own id, for an input that refers to it with `aria-labelledby`. */
  readonly id?: string;
  /** Shows the required mark; defaults to true. */
  readonly required?: boolean;
  /** The label text. */
  readonly children: ReactNode;
}) {
  return (
    <Typography
      component="label"
      htmlFor={htmlFor}
      id={id}
      variant="body2"
      sx={{ display: 'block', mb: 0.75, fontWeight: 600 }}
    >
      {children}
      {required && (
        <Box component="span" aria-hidden sx={{ color: 'error.main', ml: 0.5 }}>
          *
        </Box>
      )}
    </Typography>
  );
}

/**
 * A grey note with an information icon.
 *
 * @param props - `children`, the note's content.
 * @returns The note.
 */
function Note({ children }: { readonly children: ReactNode }) {
  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={{ px: 1.5, py: 1, bgcolor: 'action.hover', borderRadius: 1 }}
    >
      <Box sx={{ display: 'flex', pt: 0.25, color: 'text.secondary' }}>
        <Icon icon="mdi:information-outline" width={16} height={16} />
      </Box>
      <Box>{children}</Box>
    </Stack>
  );
}

const HELPER_SX = { '& .MuiFormHelperText-root': { mx: 0 } };

/**
 * The confirmed version when it is still offered, otherwise the catalog default.
 *
 * @param chosen - The version the draft holds, or null.
 * @param versions - The CLI catalog.
 * @returns The version to preselect, or null when the catalog has no available entry.
 */
function initialVersion(
  chosen: string | null,
  versions: readonly KubernetesVersionOption[]
): string | null {
  if (chosen !== null && versionAvailable(versions, chosen)) return chosen;
  return defaultKubernetesVersion(versions);
}

/**
 * The Configure step route: the cluster name, the Kubernetes version and the GPU option.
 *
 * @returns The step, or a redirect to the environment step when the step may not render.
 */
export function ConfigureStep() {
  const { t } = useTranslation();
  const state = useWorkflow();
  const draft = useSetupDraft();
  const history = useHistory();
  const versions = state.versions ?? [];
  const [name, setName] = useState(draft.name);
  const [distribution, setDistribution] = useState(draft.distribution);
  const [version, setVersion] = useState(() => initialVersion(draft.kubernetesVersion, versions));
  const [gpu, setGpu] = useState(draft.gpu);

  if (!setupStepAllowed('configure', draft, state)) {
    return <Redirect to={PLUGIN_ROUTES.environment} />;
  }

  const problem = clusterNameProblem(name);
  const recommended = defaultKubernetesVersion(versions);
  const valid =
    state.target === null &&
    configurationValid({ name, distribution, kubernetesVersion: version }, state);

  /**
   * Records the inputs and opens the Review step. Re-checks the latest state: the click can follow
   * an update that has not rendered yet.
   */
  function next() {
    const latest = getWorkflowState();
    const current = getSetupDraft();
    if (version === null || latest.target !== null) return;
    if (!setupStepAllowed('configure', current, latest)) return;
    const settings = { name, distribution, kubernetesVersion: version, gpu };
    if (!configurationValid(settings, latest)) return;
    configureCluster(settings);
    history.push(PLUGIN_ROUTES.review);
  }

  return (
    <SetupFrame step="configure" state={state}>
      <Typography variant="h5" component="h2" sx={{ fontWeight: 600 }}>
        {t('Configure your Developer Cluster')}
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'flex-start' }}>
        <Box sx={{ flex: '3 1 360px', minWidth: 0 }}>
          <Card title={String(t('Cluster settings'))} headingLevel="h3" headerFill>
            <Stack spacing={3} sx={{ p: 2 }}>
              <Box>
                <FieldLabel htmlFor={NAME_ID}>{t('Cluster name')}</FieldLabel>
                <TextField
                  id={NAME_ID}
                  required
                  fullWidth
                  variant="outlined"
                  size="small"
                  value={name}
                  error={problem !== null}
                  helperText={
                    problem === null
                      ? t(
                          'Use 1-63 lowercase letters, numbers, or hyphens. Start and end with a letter or number.'
                        )
                      : nameProblemText(t, problem)
                  }
                  onChange={event => setName(event.target.value)}
                  sx={HELPER_SX}
                />
              </Box>
              <Box>
                <FieldLabel id={DISTRIBUTION_LABEL_ID}>{t('Kubernetes distribution')}</FieldLabel>
                <RadioGroup
                  aria-labelledby={DISTRIBUTION_LABEL_ID}
                  name="kubernetes-distribution"
                  value={distribution}
                  onChange={(_, value) => {
                    if (isKubernetesDistribution(value)) setDistribution(value);
                  }}
                >
                  <FormControlLabel
                    value="K8s"
                    control={<Radio size="small" />}
                    label={t('K8s (default)')}
                  />
                  <FormControlLabel value="K3s" control={<Radio size="small" />} label={t('K3s')} />
                </RadioGroup>
              </Box>
              <Box>
                <FieldLabel id={VERSION_LABEL_ID}>{t('Kubernetes version')}</FieldLabel>
                <TextField
                  select
                  required
                  fullWidth
                  variant="outlined"
                  size="small"
                  value={version ?? ''}
                  helperText={t(
                    'Choose a version supported by Developer Cluster. This version will be installed on your new cluster.'
                  )}
                  SelectProps={{ labelId: VERSION_LABEL_ID }}
                  onChange={event => setVersion(event.target.value)}
                  sx={HELPER_SX}
                >
                  {versions.map(option => (
                    <MenuItem
                      key={option.version}
                      value={option.version}
                      disabled={option.deprecated}
                    >
                      {versionText(t, option, option.version === recommended)}
                    </MenuItem>
                  ))}
                </TextField>
                <Box sx={{ mt: 1.5 }}>
                  <Note>
                    <Typography variant="caption" component="p" color="text.secondary">
                      {t(
                        'Running the same Kubernetes minor version as your target cluster can help you test API compatibility. Local testing does not guarantee identical behavior in Azure.'
                      )}
                    </Typography>
                  </Note>
                </Box>
              </Box>
              {recommended === null && (
                <Alert severity="warning">
                  {t('No Kubernetes version is available for a new cluster.')}
                </Alert>
              )}
              <Box>
                <FieldLabel id={GPU_LABEL_ID} required={false}>
                  {t('GPU')}
                </FieldLabel>
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={gpu}
                      onChange={event => setGpu(event.target.checked)}
                      inputProps={{ 'aria-describedby': GPU_REQUIREMENTS_ID }}
                    />
                  }
                  label={String(t('Enable NVIDIA GPU'))}
                />
                <Box id={GPU_REQUIREMENTS_ID} sx={{ mt: 0.5 }}>
                  <Note>
                    <Typography variant="caption" component="p" color="text.secondary">
                      {t('GPU support requires all of the following:')}
                    </Typography>
                    <Box
                      component="ul"
                      sx={{
                        m: 0,
                        pl: 2.5,
                        listStyleType: 'disc',
                        color: 'text.secondary',
                        typography: 'caption',
                      }}
                    >
                      <li>{t('An NVIDIA GPU. AMD, Intel and other GPUs are not supported.')}</li>
                      <li>{t('A current NVIDIA driver for Windows with WSL 2 support.')}</li>
                      <li>
                        {t(
                          'The nvidia-smi command lists your GPU when you run it in a Windows terminal.'
                        )}
                      </li>
                    </Box>
                    <Typography variant="caption" component="p" color="text.secondary">
                      {t('If any of these is missing, creating the cluster fails.')}
                    </Typography>
                  </Note>
                </Box>
              </Box>
            </Stack>
          </Card>
        </Box>
        <Box sx={{ flex: '2 1 260px', minWidth: 0 }}>
          <Card title={String(t('Runtime environment'))} headingLevel="h3" headerFill>
            <DetailRows rows={environmentRows(t, distribution)} />
          </Card>
        </Box>
      </Box>
      <InfoBanner title={String(t('Your cluster, ready for apps.'))}>
        <Typography variant="body2" color="text.secondary">
          {t(
            'This preview supports one Developer Cluster in the supported Ubuntu environment. Once ready, open it in AKS Desktop to deploy and inspect your applications.'
          )}
        </Typography>
      </InfoBanner>
      <Stack direction="row" spacing={2} justifyContent="flex-end">
        <Button component={Link} to={PLUGIN_ROUTES.environment} variant="outlined">
          {t('Back')}
        </Button>
        <Button
          variant="contained"
          endIcon={<Icon icon="mdi:arrow-right" />}
          disabled={!valid}
          onClick={() => next()}
        >
          {t('Review and create')}
        </Button>
      </Stack>
    </SetupFrame>
  );
}
