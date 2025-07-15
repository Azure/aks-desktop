// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import {
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Step,
  StepContent,
  StepLabel,
  Stepper,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import React from 'react';
import { ContainerConfig } from '../hooks/useContainerConfiguration';
import { bumpWithUnit, setFromInput } from './types';

interface ConfigureContainerProps {
  containerConfig: {
    config: ContainerConfig;
    setConfig: React.Dispatch<React.SetStateAction<ContainerConfig>>;
  };
}

function LabelWithInfo({ label, infoText }: { label: string; infoText: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <span>{label}</span>
      <Tooltip title={infoText} arrow>
        <IconButton size="small" sx={{ p: 0, minWidth: 'auto', width: '20px', height: '20px' }}>
          <Icon icon="mdi:information-outline" width="16px" height="16px" />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

export default function ConfigureContainer({ containerConfig }: ConfigureContainerProps) {
  return (
    <>
      <Typography variant="h6" gutterBottom>
        Configure Container Deployment
      </Typography>
      <Stepper activeStep={containerConfig.config.containerStep} orientation="vertical">
        {/* 1. Basics: App name, image, replicas */}
        <Step>
          <StepLabel>Basics</StepLabel>
          <StepContent>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
              <TextField
                label="Application name"
                value={containerConfig.config.appName}
                onChange={e => containerConfig.setConfig(c => ({ ...c, appName: e.target.value }))}
                fullWidth
              />
              <TextField
                label="Container image"
                placeholder="registry/image:tag"
                value={containerConfig.config.containerImage}
                onChange={e =>
                  containerConfig.setConfig(c => ({ ...c, containerImage: e.target.value }))
                }
                fullWidth
              />
              <TextField
                label={
                  <LabelWithInfo
                    label="Replicas"
                    infoText="The number of pod replicas to run. More replicas provide better availability and load distribution."
                  />
                }
                type="number"
                inputProps={{ min: 1 }}
                value={containerConfig.config.replicas}
                onChange={e =>
                  containerConfig.setConfig(c => ({
                    ...c,
                    replicas: Math.max(1, Number(e.target.value)),
                  }))
                }
              />
            </Box>
            <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
              <Button
                variant="contained"
                onClick={() => containerConfig.setConfig(c => ({ ...c, containerStep: 1 }))}
                disabled={
                  !containerConfig.config.appName.trim() ||
                  !containerConfig.config.containerImage.trim() ||
                  containerConfig.config.replicas < 1
                }
              >
                Continue
              </Button>
            </Box>
          </StepContent>
        </Step>

        {/* 2. Networking: port and service */}
        <Step>
          <StepLabel>Networking</StepLabel>
          <StepContent>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
              <TextField
                label={
                  <LabelWithInfo
                    label="Target port"
                    infoText="The port number that your container listens on. This is the port inside the container where your application runs."
                  />
                }
                type="number"
                inputProps={{ min: 1 }}
                value={containerConfig.config.targetPort}
                onChange={e =>
                  containerConfig.setConfig(c => ({
                    ...c,
                    targetPort: Math.max(1, Number(e.target.value)),
                  }))
                }
              />
              {containerConfig.config.useCustomServicePort && (
                <TextField
                  label={
                    <LabelWithInfo
                      label="Service port"
                      infoText="The port number exposed by the Kubernetes service. Traffic to this port is forwarded to the target port."
                    />
                  }
                  type="number"
                  inputProps={{ min: 1 }}
                  value={containerConfig.config.servicePort}
                  onChange={e =>
                    containerConfig.setConfig(c => ({
                      ...c,
                      servicePort: Math.max(1, Number(e.target.value)),
                    }))
                  }
                />
              )}
            </Box>
            <Box sx={{ mt: 1 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={containerConfig.config.useCustomServicePort}
                    onChange={e =>
                      containerConfig.setConfig(c => ({
                        ...c,
                        useCustomServicePort: e.target.checked,
                      }))
                    }
                  />
                }
                label={
                  <LabelWithInfo
                    label="Use custom service port"
                    infoText="By default, the service port matches the target port. Enable this to use a different port for the service."
                  />
                }
              />
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ ml: 5, display: 'block', mt: -1 }}
              >
                By default, the service port matches the target port. Enable this to use a different
                port for the service.
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 2, width: '100%', mt: 1 }}>
              <Box
                onClick={() => containerConfig.setConfig(c => ({ ...c, serviceType: 'ClusterIP' }))}
                sx={{
                  flex: 1,
                  p: 2,
                  border: '2px solid',
                  borderColor:
                    containerConfig.config.serviceType === 'ClusterIP' ? 'primary.main' : 'divider',
                  borderRadius: 2,
                  cursor: 'pointer',
                  backgroundColor: 'background.paper',
                }}
              >
                <Typography variant="subtitle1" sx={{ mb: 0.5 }}>
                  Internal only
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Use ClusterIP. Best for services that are only reachable within the cluster.
                </Typography>
              </Box>
              <Box
                onClick={() =>
                  containerConfig.setConfig(c => ({ ...c, serviceType: 'LoadBalancer' }))
                }
                sx={{
                  flex: 1,
                  p: 2,
                  border: '2px solid',
                  borderColor:
                    containerConfig.config.serviceType === 'LoadBalancer'
                      ? 'primary.main'
                      : 'divider',
                  borderRadius: 2,
                  cursor: 'pointer',
                  backgroundColor: 'background.paper',
                }}
              >
                <Typography variant="subtitle1" sx={{ mb: 0.5 }}>
                  Enable public access
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Creates a LoadBalancer to expose the application to the internet.
                </Typography>
              </Box>
            </Box>
            <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
              <Button
                variant="outlined"
                onClick={() => containerConfig.setConfig(c => ({ ...c, containerStep: 0 }))}
              >
                Back
              </Button>
              <Button
                variant="contained"
                onClick={() => containerConfig.setConfig(c => ({ ...c, containerStep: 2 }))}
              >
                Continue
              </Button>
            </Box>
          </StepContent>
        </Step>

        {/* 3. Healthchecks */}
        <Step>
          <StepLabel>Healthchecks</StepLabel>
          <StepContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Configure container health probes.
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
                    label="Manually configure settings"
                    infoText="By default, probes use HTTP GET on the root path with sensible defaults. Enable this to customize probe settings."
                  />
                }
              />
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ ml: 5, display: 'block', mt: -1 }}
              >
                By default, probes use HTTP GET on the root path with sensible defaults. Enable this
                to customize probe settings.
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
                      label="Enable liveness probe"
                      infoText="Kubernetes restarts the container if this check fails repeatedly. Used to detect and recover from deadlocks or unresponsive containers."
                    />
                  }
                />
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ ml: 5, display: 'block', mt: -1 }}
                >
                  Kubernetes restarts the container if this check fails repeatedly.
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
                              label="Liveness path"
                              infoText="The HTTP path to check for liveness (e.g., /healthz). The probe performs an HTTP GET request to this path."
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
                              label="initialDelaySeconds"
                              infoText="Number of seconds after the container has started before liveness probes are initiated."
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
                              label="periodSeconds"
                              infoText="How often (in seconds) to perform the liveness probe. Default is 10 seconds."
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
                              label="timeoutSeconds"
                              infoText="Number of seconds after which the probe times out. Default is 1 second."
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
                              label="failureThreshold"
                              infoText="When a probe fails, Kubernetes will try this many times before giving up and restarting the container."
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
                              label="successThreshold"
                              infoText="Minimum consecutive successes for the probe to be considered successful after having failed. Default is 1."
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
                      label="Enable readiness probe"
                      infoText="Kubernetes won't send traffic to the pod until this check passes. Used to indicate when a container is ready to accept traffic."
                    />
                  }
                />
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ ml: 5, display: 'block', mt: -1 }}
                >
                  Kubernetes won't send traffic to the pod until this check passes.
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
                              label="Readiness path"
                              infoText="The HTTP path to check for readiness (e.g., /ready). The probe performs an HTTP GET request to this path."
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
                              label="initialDelaySeconds"
                              infoText="Number of seconds after the container has started before readiness probes are initiated."
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
                              label="periodSeconds"
                              infoText="How often (in seconds) to perform the readiness probe. Default is 10 seconds."
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
                              label="timeoutSeconds"
                              infoText="Number of seconds after which the probe times out. Default is 1 second."
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
                              label="failureThreshold"
                              infoText="When a probe fails, Kubernetes will try this many times before marking the pod as not ready."
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
                              label="successThreshold"
                              infoText="Minimum consecutive successes for the probe to be considered successful after having failed. Default is 1."
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
                      label="Enable startup probe"
                      infoText="Kubernetes temporarily disables liveness/readiness until startup succeeds. Useful for containers that take a long time to start."
                    />
                  }
                />
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ ml: 5, display: 'block', mt: -1 }}
                >
                  Kubernetes temporarily disables liveness/readiness until startup succeeds.
                </Typography>
                {containerConfig.config.enableStartupProbe &&
                  containerConfig.config.showProbeConfigs && (
                    <>
                      <Box sx={{ ml: 5, mt: 1, maxWidth: 360 }}>
                        <TextField
                          size="small"
                          fullWidth
                          label={
                            <LabelWithInfo
                              label="Startup path"
                              infoText="The HTTP path to check for startup (e.g., /startup). The probe performs an HTTP GET request to this path."
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
                              label="initialDelaySeconds"
                              infoText="Number of seconds after the container has started before startup probes are initiated."
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
                              label="periodSeconds"
                              infoText="How often (in seconds) to perform the startup probe. Default is 10 seconds."
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
                              label="timeoutSeconds"
                              infoText="Number of seconds after which the probe times out. Default is 1 second."
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
                              label="failureThreshold"
                              infoText="When a probe fails, Kubernetes will try this many times before giving up. For startup probes, this determines how long to wait before restarting."
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
                              label="successThreshold"
                              infoText="Minimum consecutive successes for the probe to be considered successful after having failed. Default is 1."
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
                onClick={() => containerConfig.setConfig(c => ({ ...c, containerStep: 1 }))}
              >
                Back
              </Button>
              <Button
                variant="contained"
                onClick={() => containerConfig.setConfig(c => ({ ...c, containerStep: 3 }))}
              >
                Continue
              </Button>
            </Box>
          </StepContent>
        </Step>

        {/* 4. Resources */}
        <Step>
          <StepLabel>Resource Limits</StepLabel>
          <StepContent>
            <FormControlLabel
              control={
                <Switch
                  checked={containerConfig.config.enableResources}
                  onChange={e =>
                    containerConfig.setConfig(c => ({ ...c, enableResources: e.target.checked }))
                  }
                />
              }
              label={
                <LabelWithInfo
                  label="Enable resource requests and limits"
                  infoText="Set CPU and memory requests (guaranteed resources) and limits (maximum resources) to control resource allocation and prevent containers from consuming excessive cluster resources."
                />
              }
            />
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(260px, 1fr))',
                gap: 2,
              }}
            >
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">
                    CPU request
                  </Typography>
                  <Tooltip
                    title="The minimum amount of CPU guaranteed to the container. Kubernetes will schedule the pod on a node with at least this much CPU available."
                    arrow
                  >
                    <IconButton
                      size="small"
                      sx={{ p: 0, minWidth: 'auto', width: '16px', height: '16px' }}
                    >
                      <Icon icon="mdi:information-outline" width="14px" height="14px" />
                    </IconButton>
                  </Tooltip>
                </Box>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <TextField
                    value={containerConfig.config.cpuRequest}
                    onChange={e =>
                      setFromInput(e.target.value, 'm', val =>
                        containerConfig.setConfig(c => ({ ...c, cpuRequest: val }))
                      )
                    }
                    placeholder="100m"
                    InputProps={{
                      endAdornment: <InputAdornment position="end">m</InputAdornment>,
                    }}
                    disabled={!containerConfig.config.enableResources}
                    sx={{ flex: 1 }}
                  />
                  <IconButton
                    size="small"
                    aria-label="decrease"
                    onClick={() =>
                      containerConfig.setConfig(c => ({
                        ...c,
                        cpuRequest: bumpWithUnit(c.cpuRequest || '100m', -50, 'm', 1),
                      }))
                    }
                    disabled={!containerConfig.config.enableResources}
                  >
                    <Icon icon="mdi:minus" />
                  </IconButton>
                  <IconButton
                    size="small"
                    aria-label="increase"
                    onClick={() =>
                      containerConfig.setConfig(c => ({
                        ...c,
                        cpuRequest: bumpWithUnit(c.cpuRequest || '100m', 50, 'm', 1),
                      }))
                    }
                    disabled={!containerConfig.config.enableResources}
                  >
                    <Icon icon="mdi:plus" />
                  </IconButton>
                </Box>
              </Box>

              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">
                    CPU limit
                  </Typography>
                  <Tooltip
                    title="The maximum amount of CPU the container can use. If exceeded, the container will be throttled."
                    arrow
                  >
                    <IconButton
                      size="small"
                      sx={{ p: 0, minWidth: 'auto', width: '16px', height: '16px' }}
                    >
                      <Icon icon="mdi:information-outline" width="14px" height="14px" />
                    </IconButton>
                  </Tooltip>
                </Box>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <TextField
                    value={containerConfig.config.cpuLimit}
                    onChange={e =>
                      setFromInput(e.target.value, 'm', val =>
                        containerConfig.setConfig(c => ({ ...c, cpuLimit: val }))
                      )
                    }
                    placeholder="500m"
                    InputProps={{
                      endAdornment: <InputAdornment position="end">m</InputAdornment>,
                    }}
                    disabled={!containerConfig.config.enableResources}
                    sx={{ flex: 1 }}
                  />
                  <IconButton
                    size="small"
                    aria-label="decrease"
                    onClick={() =>
                      containerConfig.setConfig(c => ({
                        ...c,
                        cpuLimit: bumpWithUnit(c.cpuLimit || '500m', -50, 'm', 1),
                      }))
                    }
                    disabled={!containerConfig.config.enableResources}
                  >
                    <Icon icon="mdi:minus" />
                  </IconButton>
                  <IconButton
                    size="small"
                    aria-label="increase"
                    onClick={() =>
                      containerConfig.setConfig(c => ({
                        ...c,
                        cpuLimit: bumpWithUnit(c.cpuLimit || '500m', 50, 'm', 1),
                      }))
                    }
                    disabled={!containerConfig.config.enableResources}
                  >
                    <Icon icon="mdi:plus" />
                  </IconButton>
                </Box>
              </Box>

              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">
                    Memory request
                  </Typography>
                  <Tooltip
                    title="The minimum amount of memory guaranteed to the container. Kubernetes will schedule the pod on a node with at least this much memory available."
                    arrow
                  >
                    <IconButton
                      size="small"
                      sx={{ p: 0, minWidth: 'auto', width: '16px', height: '16px' }}
                    >
                      <Icon icon="mdi:information-outline" width="14px" height="14px" />
                    </IconButton>
                  </Tooltip>
                </Box>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <TextField
                    value={containerConfig.config.memoryRequest}
                    onChange={e =>
                      setFromInput(e.target.value, 'Mi', val =>
                        containerConfig.setConfig(c => ({ ...c, memoryRequest: val }))
                      )
                    }
                    placeholder="128Mi"
                    InputProps={{
                      endAdornment: <InputAdornment position="end">Mi</InputAdornment>,
                    }}
                    disabled={!containerConfig.config.enableResources}
                    sx={{ flex: 1 }}
                  />
                  <IconButton
                    size="small"
                    aria-label="decrease"
                    onClick={() =>
                      containerConfig.setConfig(c => ({
                        ...c,
                        memoryRequest: bumpWithUnit(c.memoryRequest || '128Mi', -64, 'Mi', 1),
                      }))
                    }
                    disabled={!containerConfig.config.enableResources}
                  >
                    <Icon icon="mdi:minus" />
                  </IconButton>
                  <IconButton
                    size="small"
                    aria-label="increase"
                    onClick={() =>
                      containerConfig.setConfig(c => ({
                        ...c,
                        memoryRequest: bumpWithUnit(c.memoryRequest || '128Mi', 64, 'Mi', 1),
                      }))
                    }
                    disabled={!containerConfig.config.enableResources}
                  >
                    <Icon icon="mdi:plus" />
                  </IconButton>
                </Box>
              </Box>

              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">
                    Memory limit
                  </Typography>
                  <Tooltip
                    title="The maximum amount of memory the container can use. If exceeded, the container will be terminated (OOMKilled)."
                    arrow
                  >
                    <IconButton
                      size="small"
                      sx={{ p: 0, minWidth: 'auto', width: '16px', height: '16px' }}
                    >
                      <Icon icon="mdi:information-outline" width="14px" height="14px" />
                    </IconButton>
                  </Tooltip>
                </Box>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <TextField
                    value={containerConfig.config.memoryLimit}
                    onChange={e =>
                      setFromInput(e.target.value, 'Mi', val =>
                        containerConfig.setConfig(c => ({ ...c, memoryLimit: val }))
                      )
                    }
                    placeholder="512Mi"
                    InputProps={{
                      endAdornment: <InputAdornment position="end">Mi</InputAdornment>,
                    }}
                    disabled={!containerConfig.config.enableResources}
                    sx={{ flex: 1 }}
                  />
                  <IconButton
                    size="small"
                    aria-label="decrease"
                    onClick={() =>
                      containerConfig.setConfig(c => ({
                        ...c,
                        memoryLimit: bumpWithUnit(c.memoryLimit || '512Mi', -64, 'Mi', 1),
                      }))
                    }
                    disabled={!containerConfig.config.enableResources}
                  >
                    <Icon icon="mdi:minus" />
                  </IconButton>
                  <IconButton
                    size="small"
                    aria-label="increase"
                    onClick={() =>
                      containerConfig.setConfig(c => ({
                        ...c,
                        memoryLimit: bumpWithUnit(c.memoryLimit || '512Mi', 64, 'Mi', 1),
                      }))
                    }
                    disabled={!containerConfig.config.enableResources}
                  >
                    <Icon icon="mdi:plus" />
                  </IconButton>
                </Box>
              </Box>
            </Box>
            <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
              <Button
                variant="outlined"
                onClick={() => containerConfig.setConfig(c => ({ ...c, containerStep: 2 }))}
              >
                Back
              </Button>
              <Button
                variant="contained"
                onClick={() => containerConfig.setConfig(c => ({ ...c, containerStep: 4 }))}
              >
                Continue
              </Button>
            </Box>
          </StepContent>
        </Step>

        {/* 5. Env variables */}
        <Step>
          <StepLabel>Environment Variables</StepLabel>
          <StepContent>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {containerConfig.config.envVars.map((pair, idx) => (
                <Box key={idx} sx={{ display: 'flex', gap: 1 }}>
                  <TextField
                    label="Key"
                    value={pair.key}
                    onChange={e => {
                      const v = [...containerConfig.config.envVars];
                      v[idx] = { ...v[idx], key: e.target.value };
                      containerConfig.setConfig(c => ({ ...c, envVars: v }));
                    }}
                    sx={{ flex: 1 }}
                  />
                  <TextField
                    label="Value"
                    value={pair.value}
                    onChange={e => {
                      const v = [...containerConfig.config.envVars];
                      v[idx] = { ...v[idx], value: e.target.value };
                      containerConfig.setConfig(c => ({ ...c, envVars: v }));
                    }}
                    sx={{ flex: 1 }}
                  />
                  <IconButton
                    aria-label="remove"
                    onClick={() =>
                      containerConfig.setConfig(c => ({
                        ...c,
                        envVars: c.envVars.filter((_, i) => i !== idx),
                      }))
                    }
                  >
                    <Icon icon="mdi:delete-outline" />
                  </IconButton>
                </Box>
              ))}
              <Box>
                <Button
                  variant="text"
                  onClick={() =>
                    containerConfig.setConfig(c => ({
                      ...c,
                      envVars: [...c.envVars, { key: '', value: '' }],
                    }))
                  }
                >
                  Add variable
                </Button>
              </Box>
            </Box>
            <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
              <Button
                variant="outlined"
                onClick={() => containerConfig.setConfig(c => ({ ...c, containerStep: 3 }))}
              >
                Back
              </Button>
              <Button
                variant="contained"
                onClick={() => containerConfig.setConfig(c => ({ ...c, containerStep: 5 }))}
              >
                Continue
              </Button>
            </Box>
          </StepContent>
        </Step>

        {/* 6. HPA */}
        <Step>
          <StepLabel>HPA</StepLabel>
          <StepContent>
            <FormControlLabel
              control={
                <Switch
                  checked={containerConfig.config.enableHpa}
                  onChange={e =>
                    containerConfig.setConfig(c => ({ ...c, enableHpa: e.target.checked }))
                  }
                />
              }
              label={
                <LabelWithInfo
                  label="Enable Horizontal Pod Autoscaler"
                  infoText="Automatically scales the number of pods based on CPU utilization. HPA will increase pods when CPU usage exceeds the target and decrease when it's below."
                />
              }
            />
            {containerConfig.config.enableHpa && (
              <Box
                sx={{
                  mt: 1,
                }}
              >
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  HPA scales pods based on CPU utilization.
                </Typography>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, minmax(220px, 1fr))',
                    gap: 2,
                  }}
                >
                  <TextField
                    label={
                      <LabelWithInfo
                        label="Min replicas"
                        infoText="The minimum number of pod replicas that HPA will maintain, even when CPU usage is low."
                      />
                    }
                    type="number"
                    inputProps={{ min: 1 }}
                    value={containerConfig.config.hpaMinReplicas}
                    onChange={e => {
                      const v = Math.max(1, Number(e.target.value));
                      containerConfig.setConfig(c => ({
                        ...c,
                        hpaMinReplicas: v,
                        ...(v > c.hpaMaxReplicas ? { hpaMaxReplicas: v } : {}),
                      }));
                    }}
                  />
                  <TextField
                    label={
                      <LabelWithInfo
                        label="Max replicas"
                        infoText="The maximum number of pod replicas that HPA can scale up to when CPU usage is high."
                      />
                    }
                    type="number"
                    inputProps={{ min: 1 }}
                    value={containerConfig.config.hpaMaxReplicas}
                    onChange={e => {
                      const v = Math.max(1, Number(e.target.value));
                      containerConfig.setConfig(c => ({
                        ...c,
                        hpaMaxReplicas: v,
                        ...(v < c.hpaMinReplicas ? { hpaMinReplicas: v } : {}),
                      }));
                    }}
                  />
                </Box>

                <Box sx={{ mt: 3 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
                    <Typography variant="subtitle2">Target CPU utilization</Typography>
                    <Tooltip
                      title="The target average CPU utilization percentage across all pods. HPA will scale up when CPU usage exceeds this value and scale down when it's below."
                      arrow
                    >
                      <IconButton
                        size="small"
                        sx={{ p: 0, minWidth: 'auto', width: '20px', height: '20px' }}
                      >
                        <Icon icon="mdi:information-outline" width="16px" height="16px" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <IconButton
                      size="small"
                      onClick={() =>
                        containerConfig.setConfig(c => ({
                          ...c,
                          hpaTargetCpu: Math.max(10, Math.min(95, c.hpaTargetCpu - 5)),
                        }))
                      }
                    >
                      <Icon icon="mdi:minus" />
                    </IconButton>
                    <TextField
                      type="number"
                      value={containerConfig.config.hpaTargetCpu}
                      inputProps={{ min: 10, max: 95, step: 5 }}
                      onChange={e =>
                        containerConfig.setConfig(c => ({
                          ...c,
                          hpaTargetCpu: Math.max(10, Math.min(95, Number(e.target.value))),
                        }))
                      }
                      InputProps={{
                        endAdornment: <InputAdornment position="end">%</InputAdornment>,
                      }}
                      sx={{ width: 120 }}
                    />
                    <IconButton
                      size="small"
                      onClick={() =>
                        containerConfig.setConfig(c => ({
                          ...c,
                          hpaTargetCpu: Math.max(10, Math.min(95, c.hpaTargetCpu + 5)),
                        }))
                      }
                    >
                      <Icon icon="mdi:plus" />
                    </IconButton>
                  </Box>

                  {(containerConfig.config.hpaMinReplicas > containerConfig.config.hpaMaxReplicas ||
                    containerConfig.config.hpaTargetCpu < 10 ||
                    containerConfig.config.hpaTargetCpu > 95) && (
                    <Typography variant="caption" color="error" sx={{ mt: 1, display: 'block' }}>
                      Ensure min ≤ max replicas and target CPU between 10% and 95%.
                    </Typography>
                  )}
                </Box>
              </Box>
            )}
            <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
              <Button
                variant="outlined"
                onClick={() => containerConfig.setConfig(c => ({ ...c, containerStep: 4 }))}
              >
                Back
              </Button>
              <Button
                variant="contained"
                onClick={() => containerConfig.setConfig(c => ({ ...c, containerStep: 6 }))}
              >
                Continue
              </Button>
            </Box>
          </StepContent>
        </Step>

        {/* 7. Advanced */}
        <Step>
          <StepLabel>Advanced</StepLabel>
          <StepContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Configure security context settings for the container.
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={containerConfig.config.runAsNonRoot}
                    onChange={e =>
                      containerConfig.setConfig(c => ({ ...c, runAsNonRoot: e.target.checked }))
                    }
                  />
                }
                label={
                  <LabelWithInfo
                    label="Run as non root user"
                    infoText="Ensures the container runs as a non-root user (UID != 0) for better security. This prevents privilege escalation attacks."
                  />
                }
              />
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ ml: 5, display: 'block', mt: -1 }}
              >
                Ensures the container runs as a non-root user for better security.
              </Typography>

              <FormControlLabel
                control={
                  <Switch
                    checked={containerConfig.config.readOnlyRootFilesystem}
                    onChange={e =>
                      containerConfig.setConfig(c => ({
                        ...c,
                        readOnlyRootFilesystem: e.target.checked,
                      }))
                    }
                  />
                }
                label={
                  <LabelWithInfo
                    label="Read only root filesystem"
                    infoText="Mounts the container's root filesystem as read-only to prevent write operations. This enhances security by preventing malicious code from modifying system files."
                  />
                }
              />
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ ml: 5, display: 'block', mt: -1 }}
              >
                Mounts the container's root filesystem as read-only to prevent write operations.
              </Typography>

              <FormControlLabel
                control={
                  <Switch
                    checked={containerConfig.config.allowPrivilegeEscalation}
                    onChange={e =>
                      containerConfig.setConfig(c => ({
                        ...c,
                        allowPrivilegeEscalation: e.target.checked,
                      }))
                    }
                  />
                }
                label={
                  <LabelWithInfo
                    label="Allow privilege escalation"
                    infoText="Controls whether a process can gain more privileges than its parent process. Disabling this (recommended) prevents privilege escalation attacks."
                  />
                }
              />
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ ml: 5, display: 'block', mt: -1 }}
              >
                Controls whether a process can gain more privileges than its parent process.
              </Typography>

              <FormControlLabel
                control={
                  <Switch
                    checked={containerConfig.config.enablePodAntiAffinity}
                    onChange={e =>
                      containerConfig.setConfig(c => ({
                        ...c,
                        enablePodAntiAffinity: e.target.checked,
                      }))
                    }
                  />
                }
                label={
                  <LabelWithInfo
                    label="Enable pod anti-affinity"
                    infoText="Prefer scheduling pods on different nodes to improve availability and fault tolerance. This helps ensure pods are distributed across the cluster."
                  />
                }
              />
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ ml: 5, display: 'block', mt: -1 }}
              >
                Prefer scheduling pods on different nodes to improve availability and fault
                tolerance.
              </Typography>

              <FormControlLabel
                control={
                  <Switch
                    checked={containerConfig.config.enableTopologySpreadConstraints}
                    onChange={e =>
                      containerConfig.setConfig(c => ({
                        ...c,
                        enableTopologySpreadConstraints: e.target.checked,
                      }))
                    }
                  />
                }
                label={
                  <LabelWithInfo
                    label="Enable topology spread constraints"
                    infoText="Distributes pods evenly across nodes, zones, or other topology domains to improve workload distribution and availability."
                  />
                }
              />
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ ml: 5, display: 'block', mt: -1 }}
              >
                Distributes pods evenly across nodes to improve workload distribution.
              </Typography>
            </Box>
            <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
              <Button
                variant="outlined"
                onClick={() => containerConfig.setConfig(c => ({ ...c, containerStep: 5 }))}
              >
                Back
              </Button>
            </Box>
          </StepContent>
        </Step>
      </Stepper>
    </>
  );
}
