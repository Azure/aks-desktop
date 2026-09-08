// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import React from 'react';
import { CONTAINER_STEPS } from '../hooks/useContainerConfiguration';
import { ContainerConfigProp, LabelWithInfo } from './configureContainerUtils';

interface HealthchecksStepProps {
  containerConfig: ContainerConfigProp;
}

export default function HealthchecksStep({ containerConfig }: HealthchecksStepProps) {
  const { t } = useTranslation();

  return (
    <>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {t('Configure container health probes.')}
      </Typography>
      <Box sx={{ mb: 2 }}>
        <FormControlLabel
          control={
            <Switch
              checked={containerConfig.config.showProbeConfigs}
              onChange={e =>
                containerConfig.setConfig(c => ({ ...c, showProbeConfigs: e.target.checked }))
              }
            />
          }
          label={
            <LabelWithInfo
              label={t('Manually configure settings')}
              infoText={t(
                'By default, probes use HTTP GET on the root path with sensible defaults. Enable this to customize probe settings.'
              )}
            />
          }
        />
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ ml: 5, display: 'block', mt: -1 }}
        >
          {t(
            'By default, probes use HTTP GET on the root path with sensible defaults. Enable this to customize probe settings.'
          )}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column' }}>
        <Box>
          <FormControlLabel
            control={
              <Checkbox
                checked={containerConfig.config.enableLivenessProbe}
                onChange={e =>
                  containerConfig.setConfig(c => ({
                    ...c,
                    enableLivenessProbe: e.target.checked,
                  }))
                }
              />
            }
            label={
              <LabelWithInfo
                label={t('Enable liveness probe')}
                infoText={t(
                  'Kubernetes restarts the container if this check fails repeatedly. Used to detect and recover from deadlocks or unresponsive containers.'
                )}
              />
            }
          />
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ ml: 5, display: 'block', mt: -1 }}
          >
            {t('Kubernetes restarts the container if this check fails repeatedly.')}
          </Typography>
          {containerConfig.config.enableLivenessProbe &&
            containerConfig.config.showProbeConfigs && (
              <>
                <Box sx={{ ml: 5, mt: 1, maxWidth: 360 }}>
                  <TextField
                    size="small"
                    fullWidth
                    label={
                      <LabelWithInfo
                        label={t('Liveness path')}
                        infoText={t(
                          'The HTTP path to check for liveness (e.g., /healthz). The probe performs an HTTP GET request to this path.'
                        )}
                      />
                    }
                    value={containerConfig.config.livenessPath}
                    onChange={e =>
                      containerConfig.setConfig(c => ({ ...c, livenessPath: e.target.value }))
                    }
                    placeholder="/healthz"
                  />
                </Box>
                <Box sx={{ ml: 5, mt: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  <TextField
                    size="small"
                    type="number"
                    label={
                      <LabelWithInfo
                        label={t('initialDelaySeconds')}
                        infoText={t(
                          'Number of seconds after the container has started before liveness probes are initiated.'
                        )}
                      />
                    }
                    value={containerConfig.config.livenessInitialDelay}
                    onChange={e =>
                      containerConfig.setConfig(c => ({
                        ...c,
                        livenessInitialDelay: Math.max(0, Number(e.target.value)),
                      }))
                    }
                  />
                  <TextField
                    size="small"
                    type="number"
                    label={
                      <LabelWithInfo
                        label={t('periodSeconds')}
                        infoText={t(
                          'How often (in seconds) to perform the liveness probe. Default is 10 seconds.'
                        )}
                      />
                    }
                    value={containerConfig.config.livenessPeriod}
                    onChange={e =>
                      containerConfig.setConfig(c => ({
                        ...c,
                        livenessPeriod: Math.max(1, Number(e.target.value)),
                      }))
                    }
                  />
                  <TextField
                    size="small"
                    type="number"
                    label={
                      <LabelWithInfo
                        label={t('timeoutSeconds')}
                        infoText={t(
                          'Number of seconds after which the probe times out. Default is 1 second.'
                        )}
                      />
                    }
                    value={containerConfig.config.livenessTimeout}
                    onChange={e =>
                      containerConfig.setConfig(c => ({
                        ...c,
                        livenessTimeout: Math.max(1, Number(e.target.value)),
                      }))
                    }
                  />
                  <TextField
                    size="small"
                    type="number"
                    label={
                      <LabelWithInfo
                        label={t('failureThreshold')}
                        infoText={t(
                          'When a probe fails, Kubernetes will try this many times before giving up and restarting the container.'
                        )}
                      />
                    }
                    value={containerConfig.config.livenessFailure}
                    onChange={e =>
                      containerConfig.setConfig(c => ({
                        ...c,
                        livenessFailure: Math.max(1, Number(e.target.value)),
                      }))
                    }
                  />
                  <TextField
                    size="small"
                    type="number"
                    label={
                      <LabelWithInfo
                        label={t('successThreshold')}
                        infoText={t(
                          'Minimum consecutive successes for the probe to be considered successful after having failed. Default is 1.'
                        )}
                      />
                    }
                    value={containerConfig.config.livenessSuccess}
                    onChange={e =>
                      containerConfig.setConfig(c => ({
                        ...c,
                        livenessSuccess: Math.max(1, Number(e.target.value)),
                      }))
                    }
                  />
                </Box>
              </>
            )}
        </Box>
        <Box sx={{ mt: 1 }}>
          <FormControlLabel
            control={
              <Checkbox
                checked={containerConfig.config.enableReadinessProbe}
                onChange={e =>
                  containerConfig.setConfig(c => ({
                    ...c,
                    enableReadinessProbe: e.target.checked,
                  }))
                }
              />
            }
            label={
              <LabelWithInfo
                label={t('Enable readiness probe')}
                infoText={t(
                  "Kubernetes won't send traffic to the pod until this check passes. Used to indicate when a container is ready to accept traffic."
                )}
              />
            }
          />
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ ml: 5, display: 'block', mt: -1 }}
          >
            {t("Kubernetes won't send traffic to the pod until this check passes.")}
          </Typography>
          {containerConfig.config.enableReadinessProbe &&
            containerConfig.config.showProbeConfigs && (
              <>
                <Box sx={{ ml: 5, mt: 1, maxWidth: 360 }}>
                  <TextField
                    size="small"
                    fullWidth
                    label={
                      <LabelWithInfo
                        label={t('Readiness path')}
                        infoText={t(
                          'The HTTP path to check for readiness (e.g., /ready). The probe performs an HTTP GET request to this path.'
                        )}
                      />
                    }
                    value={containerConfig.config.readinessPath}
                    onChange={e =>
                      containerConfig.setConfig(c => ({
                        ...c,
                        readinessPath: e.target.value,
                      }))
                    }
                    placeholder="/ready"
                  />
                </Box>
                <Box sx={{ ml: 5, mt: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  <TextField
                    size="small"
                    type="number"
                    label={
                      <LabelWithInfo
                        label={t('initialDelaySeconds')}
                        infoText={t(
                          'Number of seconds after the container has started before readiness probes are initiated.'
                        )}
                      />
                    }
                    value={containerConfig.config.readinessInitialDelay}
                    onChange={e =>
                      containerConfig.setConfig(c => ({
                        ...c,
                        readinessInitialDelay: Math.max(0, Number(e.target.value)),
                      }))
                    }
                  />
                  <TextField
                    size="small"
                    type="number"
                    label={
                      <LabelWithInfo
                        label={t('periodSeconds')}
                        infoText={t(
                          'How often (in seconds) to perform the readiness probe. Default is 10 seconds.'
                        )}
                      />
                    }
                    value={containerConfig.config.readinessPeriod}
                    onChange={e =>
                      containerConfig.setConfig(c => ({
                        ...c,
                        readinessPeriod: Math.max(1, Number(e.target.value)),
                      }))
                    }
                  />
                  <TextField
                    size="small"
                    type="number"
                    label={
                      <LabelWithInfo
                        label={t('timeoutSeconds')}
                        infoText={t(
                          'Number of seconds after which the probe times out. Default is 1 second.'
                        )}
                      />
                    }
                    value={containerConfig.config.readinessTimeout}
                    onChange={e =>
                      containerConfig.setConfig(c => ({
                        ...c,
                        readinessTimeout: Math.max(1, Number(e.target.value)),
                      }))
                    }
                  />
                  <TextField
                    size="small"
                    type="number"
                    label={
                      <LabelWithInfo
                        label={t('failureThreshold')}
                        infoText={t(
                          'When a probe fails, Kubernetes will try this many times before marking the pod as not ready.'
                        )}
                      />
                    }
                    value={containerConfig.config.readinessFailure}
                    onChange={e =>
                      containerConfig.setConfig(c => ({
                        ...c,
                        readinessFailure: Math.max(1, Number(e.target.value)),
                      }))
                    }
                  />
                  <TextField
                    size="small"
                    type="number"
                    label={
                      <LabelWithInfo
                        label={t('successThreshold')}
                        infoText={t(
                          'Minimum consecutive successes for the probe to be considered successful after having failed. Default is 1.'
                        )}
                      />
                    }
                    value={containerConfig.config.readinessSuccess}
                    onChange={e =>
                      containerConfig.setConfig(c => ({
                        ...c,
                        readinessSuccess: Math.max(1, Number(e.target.value)),
                      }))
                    }
                  />
                </Box>
              </>
            )}
        </Box>
        <Box sx={{ mt: 1 }}>
          <FormControlLabel
            control={
              <Checkbox
                checked={containerConfig.config.enableStartupProbe}
                onChange={e =>
                  containerConfig.setConfig(c => ({
                    ...c,
                    enableStartupProbe: e.target.checked,
                  }))
                }
              />
            }
            label={
              <LabelWithInfo
                label={t('Enable startup probe')}
                infoText={t(
                  'Kubernetes temporarily disables liveness/readiness until startup succeeds. Useful for containers that take a long time to start.'
                )}
              />
            }
          />
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ ml: 5, display: 'block', mt: -1 }}
          >
            {t('Kubernetes temporarily disables liveness/readiness until startup succeeds.')}
          </Typography>
          {containerConfig.config.enableStartupProbe && containerConfig.config.showProbeConfigs && (
            <>
              <Box sx={{ ml: 5, mt: 1, maxWidth: 360 }}>
                <TextField
                  size="small"
                  fullWidth
                  label={
                    <LabelWithInfo
                      label={t('Startup path')}
                      infoText={t(
                        'The HTTP path to check for startup (e.g., /startup). The probe performs an HTTP GET request to this path.'
                      )}
                    />
                  }
                  value={containerConfig.config.startupPath}
                  onChange={e =>
                    containerConfig.setConfig(c => ({ ...c, startupPath: e.target.value }))
                  }
                  placeholder="/startup"
                />
              </Box>
              <Box sx={{ ml: 5, mt: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <TextField
                  size="small"
                  type="number"
                  label={
                    <LabelWithInfo
                      label={t('initialDelaySeconds')}
                      infoText={t(
                        'Number of seconds after the container has started before startup probes are initiated.'
                      )}
                    />
                  }
                  value={containerConfig.config.startupInitialDelay}
                  onChange={e =>
                    containerConfig.setConfig(c => ({
                      ...c,
                      startupInitialDelay: Math.max(0, Number(e.target.value)),
                    }))
                  }
                />
                <TextField
                  size="small"
                  type="number"
                  label={
                    <LabelWithInfo
                      label={t('periodSeconds')}
                      infoText={t(
                        'How often (in seconds) to perform the startup probe. Default is 10 seconds.'
                      )}
                    />
                  }
                  value={containerConfig.config.startupPeriod}
                  onChange={e =>
                    containerConfig.setConfig(c => ({
                      ...c,
                      startupPeriod: Math.max(1, Number(e.target.value)),
                    }))
                  }
                />
                <TextField
                  size="small"
                  type="number"
                  label={
                    <LabelWithInfo
                      label={t('timeoutSeconds')}
                      infoText={t(
                        'Number of seconds after which the probe times out. Default is 1 second.'
                      )}
                    />
                  }
                  value={containerConfig.config.startupTimeout}
                  onChange={e =>
                    containerConfig.setConfig(c => ({
                      ...c,
                      startupTimeout: Math.max(1, Number(e.target.value)),
                    }))
                  }
                />
                <TextField
                  size="small"
                  type="number"
                  label={
                    <LabelWithInfo
                      label={t('failureThreshold')}
                      infoText={t(
                        'When a probe fails, Kubernetes will try this many times before giving up. For startup probes, this determines how long to wait before restarting.'
                      )}
                    />
                  }
                  value={containerConfig.config.startupFailure}
                  onChange={e =>
                    containerConfig.setConfig(c => ({
                      ...c,
                      startupFailure: Math.max(1, Number(e.target.value)),
                    }))
                  }
                />
                <TextField
                  size="small"
                  type="number"
                  label={
                    <LabelWithInfo
                      label={t('successThreshold')}
                      infoText={t(
                        'Minimum consecutive successes for the probe to be considered successful after having failed. Default is 1.'
                      )}
                    />
                  }
                  value={containerConfig.config.startupSuccess}
                  onChange={e =>
                    containerConfig.setConfig(c => ({
                      ...c,
                      startupSuccess: Math.max(1, Number(e.target.value)),
                    }))
                  }
                />
              </Box>
            </>
          )}
        </Box>
      </Box>
      <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
        <Button
          variant="outlined"
          onClick={() =>
            containerConfig.setConfig(c => ({ ...c, containerStep: CONTAINER_STEPS.NETWORKING }))
          }
        >
          {t('Back')}
        </Button>
        <Button
          variant="contained"
          onClick={() =>
            containerConfig.setConfig(c => ({ ...c, containerStep: CONTAINER_STEPS.RESOURCES }))
          }
        >
          {t('Continue')}
        </Button>
      </Box>
    </>
  );
}
