import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { ConfirmDialog } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormHelperText,
  Grid,
  IconButton,
  Link as MuiLink,
  Menu,
  MenuItem,
  Paper,
  Select,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { type ReactNode, useEffect, useState } from 'react';
import {
  getDefaultConfig,
  getProviderById,
  getProviderFields,
  modelProviders,
} from '../../config/modelConfig';
import { getModelDisplayName } from '../../utils/modalUtils';
import {
  collectAzureOpenAIProviders,
  detectCopilotChatModels,
  detectCopilotProvider,
  type DetectedProvider,
  detectGhCliAvailable,
  detectOllamaProvider,
  detectProviders,
  GH_CLI_AUTH_SENTINEL,
  refreshGitHubToken,
} from '../../utils/providerAutoDetect';
import {
  deleteProviderConfig,
  getActiveConfig,
  isSameStoredConfig,
  SavedConfigurations,
  saveProviderConfig,
  saveTermsAcceptance,
  StoredProviderConfig,
} from '../../utils/ProviderConfigManager';
import TermsDialog from './TermsDialog';

type StatusKind = { kind: 'success' | 'error'; text: string; hint?: ReactNode };

function StatusMessage({ status }: { status: StatusKind }) {
  return (
    <Box sx={{ mb: 2 }}>
      <Typography
        variant="caption"
        sx={{
          display: 'block',
          color: status.kind === 'success' ? 'success.main' : 'error.main',
        }}
      >
        {status.text}
      </Typography>
      {status.hint}
    </Box>
  );
}

function getHostOS(): 'mac' | 'windows' | 'other' {
  const platform = navigator?.platform ?? '';
  if (platform.startsWith('Mac')) return 'mac';
  if (platform.startsWith('Win')) return 'windows';
  return 'other';
}

function GhNotInstalledHint({ t }: { t: (key: string) => string }) {
  const os = getHostOS();
  const installCommand =
    os === 'mac' ? 'brew install gh' : os === 'windows' ? 'winget install GitHub.cli' : null;

  return (
    <Box sx={{ mt: 0.75 }}>
      <Typography variant="caption" color="text.secondary" display="block">
        {t(
          'GitHub CLI (gh) does not appear to be installed. Install it to enable GitHub Copilot auto-detection:'
        )}
      </Typography>
      {installCommand && (
        <Box sx={{ mt: 0.25 }}>
          <Box component="code" sx={{ fontFamily: 'monospace', fontSize: 'caption.fontSize' }}>
            {installCommand}
          </Box>
        </Box>
      )}
      <MuiLink
        href="https://cli.github.com/"
        target="_blank"
        rel="noopener noreferrer"
        variant="caption"
        sx={{ mt: 0.5, display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
      >
        <Icon icon="mdi:open-in-new" width="12px" aria-hidden="true" focusable="false" />
        {t('Get started with GitHub CLI')}
      </MuiLink>
    </Box>
  );
}

interface ProviderSelectionDialogProps {
  open: boolean;
  onClose: () => void;
  onSelectProvider: (providerId: string) => void;
  onDetectAll?: () => void;
  isDetectingAll?: boolean;
  detectAllStatus?: { kind: 'success' | 'error'; text: string; hint?: ReactNode } | null;
}

function ProviderSelectionDialog({
  open,
  onClose,
  onSelectProvider,
  onDetectAll,
  isDetectingAll = false,
  detectAllStatus,
}: ProviderSelectionDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onClose={isDetectingAll ? undefined : onClose} maxWidth="md">
      <DialogTitle>
        <Box display="flex" alignItems="center" gap={1}>
          <Icon
            icon="mdi:plus-circle"
            width="24px"
            height="24px"
            aria-hidden="true"
            focusable="false"
          />
          <Typography variant="h6">{t('Select Provider')}</Typography>
        </Box>
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 3, color: 'text.secondary' }}>
          {t('Select a provider to add a new configuration')}
        </Typography>
        {detectAllStatus && <StatusMessage status={detectAllStatus} />}
        <Grid container spacing={2}>
          {modelProviders.map(provider => (
            <Grid item key={provider.id} xs={6} md={3}>
              <Paper
                component="button"
                sx={{
                  p: 2,
                  cursor: isDetectingAll ? 'not-allowed' : 'pointer',
                  border: '1px solid',
                  borderColor: 'divider',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  transition: 'all 0.2s',
                  opacity: isDetectingAll ? 0.4 : 1,
                  width: '100%',
                  background: 'inherit',
                  font: 'inherit',
                  '&:hover': isDetectingAll
                    ? {}
                    : {
                        borderColor: 'primary.main',
                        boxShadow: 2,
                      },
                }}
                disabled={isDetectingAll}
                onClick={() => {
                  if (!isDetectingAll) onSelectProvider(provider.id);
                }}
              >
                <Icon
                  icon={provider.icon}
                  width="32px"
                  height="32px"
                  aria-hidden="true"
                  focusable="false"
                />
                <Typography variant="body1" sx={{ mt: 1, fontWeight: 'medium' }}>
                  {provider.name}
                </Typography>
              </Paper>
            </Grid>
          ))}
        </Grid>
      </DialogContent>
      <DialogActions>
        {onDetectAll && (
          <Button
            variant="outlined"
            startIcon={
              isDetectingAll ? (
                <CircularProgress size={16} color="primary" />
              ) : (
                <Icon icon="mdi:magnify" />
              )
            }
            onClick={onDetectAll}
            disabled={isDetectingAll}
          >
            {isDetectingAll ? t('Auto Detecting...') : t('Auto Detect')}
          </Button>
        )}
        <Button onClick={onClose} disabled={isDetectingAll}>
          {t('Cancel')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// Configuration dialog component
interface ConfigurationDialogProps {
  open: boolean;
  onClose: () => void;
  providerId: string;
  config: Record<string, any>;
  onConfigChange: (config: Record<string, any>) => void;
  configName: string;
  onConfigNameChange?: (name: string) => void;
  onSave?: (makeDefault: boolean) => void;
  onDetectProvider?: (providerId: string) => Promise<DetectedProvider | null>;
}

function ConfigurationDialog({
  open,
  onClose,
  providerId,
  config,
  onConfigChange,
  configName,
  onConfigNameChange,
  onSave,
  onDetectProvider,
}: ConfigurationDialogProps) {
  const provider = getProviderById(providerId);
  const fields = getProviderFields(providerId);
  const [initialRender, setInitialRender] = useState(true);
  const [isDetectingProvider, setIsDetectingProvider] = useState(false);
  const [detectStatus, setDetectStatus] = useState<{
    kind: 'success' | 'error';
    text: string;
    hint?: ReactNode;
  } | null>(null);
  const [liveModelOptions, setLiveModelOptions] = useState<string[]>([]);
  const { t } = useTranslation();

  const isDetectSupported =
    providerId === 'copilot' || providerId === 'azure' || providerId === 'local';

  // For Copilot, fetch live model list when dialog opens and a token is available.
  // Debounce typed PATs by 600 ms and require at least 30 chars before hitting the
  // network — the sentinel is a stable stored value and bypasses both checks.
  useEffect(() => {
    if (!open || providerId !== 'copilot') {
      return;
    }

    const storedKey = config.apiKey;
    const isSentinel = storedKey === GH_CLI_AUTH_SENTINEL;
    const isTypedKey = Boolean(storedKey && !isSentinel);
    if (!isSentinel && !isTypedKey) {
      return;
    }

    // Don't fetch with obviously-incomplete typed keys.
    if (isTypedKey && storedKey.length < 30) {
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        // Use the stored token if it's real, otherwise refresh from gh CLI.
        const token = isTypedKey ? storedKey : await refreshGitHubToken();
        if (!token || cancelled) return;
        const models = await detectCopilotChatModels(token);
        if (!cancelled && models !== null && models.length > 0) {
          setLiveModelOptions(models);
        }
      } catch {
        // CORS or auth failure — silently keep static options
      }
    };

    // Sentinel (and the initial open with no key): fire immediately.
    // Typed keys: debounce so rapid keystrokes don't generate a burst of requests.
    const delay = isTypedKey ? 600 : 0;
    const timer = setTimeout(run, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, providerId, config.apiKey]);

  const formatModelLabel = (value: string) => {
    if (providerId === 'copilot') {
      return getModelDisplayName(value);
    }
    return value;
  };

  const handleFieldChange = (fieldName: string, value: any) => {
    // Update the config with the new field value
    onConfigChange({
      ...config,
      [fieldName]: value,
    });

    // If we're changing a model identifier field and have a standard auto-generated name,
    // this will trigger the useEffect to update the name
    // The useEffect will handle the name update based on the configName pattern
  };

  // Generate a name on initial render if no name is provided
  useEffect(() => {
    // Only set the name if it's an initial render and no name has been set
    if (onConfigNameChange && provider && initialRender && !configName) {
      // Simply use the provider name as the initial configuration name
      const name = provider.name || providerId;
      onConfigNameChange(name);
      setInitialRender(false);
    }
  }, [providerId, configName, onConfigNameChange, provider, initialRender]);

  useEffect(() => {
    setDetectStatus(null);
    setIsDetectingProvider(false);
    setLiveModelOptions([]);
  }, [open, providerId]);

  const isValid = provider?.fields.every(
    field => !field.required || (config[field.name] && config[field.name] !== '')
  );

  const handleDetectProvider = async () => {
    if (!onDetectProvider || !isDetectSupported) {
      return;
    }

    setIsDetectingProvider(true);
    setDetectStatus(null);

    const detected = await onDetectProvider(providerId);
    if (detected) {
      onConfigChange({ ...config, ...detected.config });
      if (
        onConfigNameChange &&
        (!configName || configName === provider?.name || configName === providerId)
      ) {
        onConfigNameChange(detected.displayName || provider?.name || providerId);
      }
      setDetectStatus({ kind: 'success', text: t('Detected and applied provider settings.') });
    } else {
      let hint: ReactNode | undefined;
      if (providerId === 'copilot') {
        const ghAvailable = await detectGhCliAvailable();
        if (!ghAvailable) {
          hint = <GhNotInstalledHint t={t} />;
        }
      }
      setDetectStatus({
        kind: 'error',
        text: t('No detectable settings found for this provider in your environment.'),
        hint,
      });
    }

    setIsDetectingProvider(false);
  };

  return (
    <Dialog open={open} onClose={isDetectingProvider ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" gap={1}>
          {provider && (
            <Icon
              icon={provider.icon}
              width="24px"
              height="24px"
              aria-hidden="true"
              focusable="false"
            />
          )}
          <Typography variant="h6">
            {provider
              ? t('Configure {{provider}}', { provider: provider.name })
              : t('Configure Provider')}
          </Typography>
        </Box>
      </DialogTitle>
      <DialogContent>
        {provider && (
          <Box
            sx={{
              p: 1,
              opacity: isDetectingProvider ? 0.5 : 1,
              pointerEvents: isDetectingProvider ? 'none' : 'auto',
              transition: 'opacity 0.2s',
            }}
          >
            <Typography variant="body2" sx={{ mb: 3, color: 'text.secondary' }}>
              {t(provider.description)}
            </Typography>

            {detectStatus && <StatusMessage status={detectStatus} />}

            {onConfigNameChange && (
              <Box sx={{ mb: 3 }}>
                <Typography variant="body2" sx={{ mb: 0.5 }}>
                  {t('Configuration Name')}
                </Typography>
                <TextField
                  value={configName}
                  onChange={e => {
                    onConfigNameChange(e.target.value);
                  }}
                  size="small"
                  fullWidth
                  placeholder={t('Give this configuration a name')}
                  helperText={t('A friendly name to identify this configuration')}
                  inputProps={{ 'aria-label': t('Configuration Name') }}
                />
              </Box>
            )}

            <Grid container spacing={2}>
              {fields.map(field => (
                <Grid item xs={12} md={6} key={field.name}>
                  {field.type === 'select' && field.name === 'model' ? (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="body2" sx={{ mb: 0.5 }}>
                        {t(field.label)}
                        {field.required && (
                          <Box component="span" sx={{ color: 'error.main' }}>
                            {' '}
                            *
                          </Box>
                        )}
                      </Typography>
                      <Autocomplete
                        id={`field-${field.name}`}
                        freeSolo
                        options={(() => {
                          const effectiveOptions =
                            liveModelOptions.length > 0 ? liveModelOptions : field.options ?? [];
                          const current = config[field.name];
                          return current && !effectiveOptions.includes(current)
                            ? [current, ...effectiveOptions]
                            : effectiveOptions;
                        })()}
                        getOptionLabel={option => formatModelLabel(String(option || ''))}
                        value={config[field.name] || ''}
                        onChange={(_, newValue) => {
                          handleFieldChange(field.name, newValue || '');
                        }}
                        onInputChange={(_, newInputValue) => {
                          handleFieldChange(field.name, newInputValue);
                        }}
                        renderInput={params => (
                          <TextField
                            {...params}
                            fullWidth
                            size="small"
                            inputProps={{ ...params.inputProps, 'aria-label': t(field.label) }}
                            placeholder={t(
                              'Enter or select model name (e.g., gpt-4, claude-3-opus, custom-model)'
                            )}
                            helperText={(() => {
                              const effectiveOptions =
                                liveModelOptions.length > 0
                                  ? liveModelOptions
                                  : field.options ?? [];
                              if (!config[field.name]) {
                                return t('Enter a model name or select from the dropdown');
                              }
                              return effectiveOptions.includes(config[field.name])
                                ? t('Using model: {{model}}', {
                                    model: formatModelLabel(String(config[field.name])),
                                  })
                                : t('Using custom model: {{model}}', {
                                    model: formatModelLabel(String(config[field.name])),
                                  });
                            })()}
                            InputProps={{
                              ...params.InputProps,
                              startAdornment:
                                config[field.name] &&
                                !(
                                  liveModelOptions.length > 0
                                    ? liveModelOptions
                                    : field.options ?? []
                                ).includes(config[field.name]) ? (
                                  <Box sx={{ mr: 1 }}>
                                    <Chip
                                      label={t('Custom')}
                                      size="small"
                                      color="primary"
                                      variant="outlined"
                                      sx={{ fontSize: '0.7rem', height: '20px' }}
                                    />
                                  </Box>
                                ) : null,
                              endAdornment: config[field.name] ? (
                                <IconButton
                                  size="small"
                                  onClick={() => {
                                    const defaultModel = field.default || field.options?.[0] || '';
                                    handleFieldChange(field.name, defaultModel);
                                  }}
                                  title={t('Reset to default model')}
                                >
                                  <Icon
                                    icon="mdi:restore"
                                    width="16px"
                                    aria-hidden="true"
                                    focusable="false"
                                  />
                                </IconButton>
                              ) : null,
                            }}
                          />
                        )}
                      />
                      {field.description && <FormHelperText>{t(field.description)}</FormHelperText>}
                    </Box>
                  ) : field.type === 'select' ? (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="body2" sx={{ mb: 0.5 }}>
                        {t(field.label)}
                        {field.required && (
                          <Box component="span" sx={{ color: 'error.main' }}>
                            {' '}
                            *
                          </Box>
                        )}
                      </Typography>
                      <Select
                        value={config[field.name] || ''}
                        onChange={e => handleFieldChange(field.name, e.target.value)}
                        fullWidth
                        size="small"
                        displayEmpty
                        inputProps={{ 'aria-label': t(field.label) }}
                      >
                        <MenuItem value="" disabled>
                          <em>{t('Select {{field}}', { field: t(field.label) })}</em>
                        </MenuItem>
                        {field.options?.map(option => (
                          <MenuItem key={option} value={option}>
                            {formatModelLabel(option)}
                          </MenuItem>
                        ))}
                      </Select>
                      {field.description && <FormHelperText>{t(field.description)}</FormHelperText>}
                    </Box>
                  ) : field.type === 'number' ? (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="body2" sx={{ mb: 0.5 }}>
                        {t(field.label)}
                        {field.required && (
                          <Box component="span" sx={{ color: 'error.main' }}>
                            {' '}
                            *
                          </Box>
                        )}
                      </Typography>
                      <TextField
                        type="number"
                        value={config[field.name] || ''}
                        onChange={e => handleFieldChange(field.name, e.target.value)}
                        fullWidth
                        size="small"
                        placeholder={field.placeholder ? t(field.placeholder) : undefined}
                        inputProps={{ step: 0.1, 'aria-label': t(field.label) }}
                      />
                      {field.description && <FormHelperText>{t(field.description)}</FormHelperText>}
                    </Box>
                  ) : (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="body2" sx={{ mb: 0.5 }}>
                        {t(field.label)}
                        {field.required && (
                          <Box component="span" sx={{ color: 'error.main' }}>
                            {' '}
                            *
                          </Box>
                        )}
                      </Typography>
                      <TextField
                        type={field.name.toLowerCase().includes('key') ? 'password' : 'text'}
                        value={config[field.name] || ''}
                        onChange={e => handleFieldChange(field.name, e.target.value)}
                        fullWidth
                        size="small"
                        placeholder={field.placeholder ? t(field.placeholder) : undefined}
                        inputProps={{ 'aria-label': t(field.label) }}
                      />
                      {field.description && <FormHelperText>{t(field.description)}</FormHelperText>}
                    </Box>
                  )}
                </Grid>
              ))}
            </Grid>

            {/* Show only this model switch - only show if multiple models are available */}
            {(() => {
              // Get all available models for this provider
              const modelField = fields.find(field => field.name === 'model');
              const availableModels = modelField?.options || [];
              const hasCustomModel = config.model && !availableModels.includes(config.model);
              const totalModels = availableModels.length + (hasCustomModel ? 1 : 0);

              // Only show the switch if there are multiple models available
              if (totalModels > 1) {
                return (
                  <Box sx={{ mt: 3, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={config.showOnlyThisModel || false}
                          onChange={e => {
                            handleFieldChange('showOnlyThisModel', e.target.checked);
                          }}
                          size="small"
                        />
                      }
                      label={
                        <Box>
                          <Typography variant="body2">
                            {t('Show only this model in chat window')}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {t(
                              'When enabled, only this specific model will appear in the chat selector, hiding other models from this provider.'
                            )}
                          </Typography>
                        </Box>
                      }
                    />
                  </Box>
                );
              }
              return null;
            })()}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="body2" color={isValid ? 'success.main' : 'error.main'}>
            {isValid ? t('Configuration is valid.') : t('Please fill in all required fields.')}
          </Typography>
        </Box>
        {onDetectProvider && isDetectSupported && (
          <Button
            variant="outlined"
            startIcon={
              isDetectingProvider ? (
                <CircularProgress size={16} color="inherit" />
              ) : (
                <Icon icon="mdi:magnify" />
              )
            }
            onClick={handleDetectProvider}
            disabled={isDetectingProvider}
          >
            {isDetectingProvider ? t('Auto Detecting...') : t('Auto Detect')}
          </Button>
        )}
        <Button onClick={onClose} disabled={isDetectingProvider}>
          {t('Cancel')}
        </Button>
        {onSave && (
          <Button
            variant="contained"
            color="primary"
            onClick={() => onSave(true)}
            disabled={!isValid || isDetectingProvider}
          >
            {t('Save')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

interface ModelSelectorProps {
  selectedProvider: string;
  config: Record<string, any>;
  savedConfigs: SavedConfigurations;
  configName?: string;
  isConfigView?: boolean;
  onChange?: (changes: {
    providerId: string;
    config: Record<string, any>;
    displayName: string;
    savedConfigs?: SavedConfigurations;
  }) => void;
  onTermsAccept?: (updatedConfigs: SavedConfigurations) => void;
  /** Called with detected providers when "Auto Detect All" completes. The parent
   * is responsible for showing a selection dialog and saving the chosen providers. */
  onAutoDetectResults?: (providers: DetectedProvider[]) => void;
}

export default function ModelSelector({
  selectedProvider,
  config,
  savedConfigs,
  configName = '',
  isConfigView = false,
  onChange,
  onTermsAccept,
  onAutoDetectResults,
}: ModelSelectorProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogProviderId, setDialogProviderId] = useState('');
  const [dialogConfig, setDialogConfig] = useState<Record<string, any>>({});
  const [dialogConfigName, setDialogConfigName] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const { t } = useTranslation();

  // New state for provider selection dialog
  const [providerSelectionOpen, setProviderSelectionOpen] = useState(false);

  // State for terms dialog
  const [termsDialogOpen, setTermsDialogOpen] = useState(false);
  const [isDetectingAllProviders, setIsDetectingAllProviders] = useState(false);
  const [detectAllStatus, setDetectAllStatus] = useState<{
    kind: 'success' | 'error';
    text: string;
    hint?: ReactNode;
  } | null>(null);

  // State for the 3-dot menu
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedConfigIndex, setSelectedConfigIndex] = useState<number | null>(null);
  const openMenu = Boolean(anchorEl);

  // Check if terms have been accepted
  const hasAcceptedTerms = () => {
    return savedConfigs?.termsAccepted || false;
  };

  // Save terms acceptance
  const acceptTerms = () => {
    if (onTermsAccept) {
      const updatedConfigs = saveTermsAcceptance(savedConfigs);
      onTermsAccept(updatedConfigs);
    }
  };

  // Open dialog with provider configuration
  const handleOpenDialog = (providerId: string, isNewConfig = false) => {
    setDialogProviderId(providerId);

    // Get provider info to access its name
    const providerInfo = getProviderById(providerId);
    const providerName = providerInfo?.name || providerId;

    // If this is editing the currently selected provider, use its config
    if (providerId === selectedProvider && !isNewConfig) {
      setDialogConfig({ ...config });
      setDialogConfigName(configName);
    } else {
      // For a new config or a different provider, use default config
      const defaultConfig = getDefaultConfig(providerId);
      setDialogConfig({ ...defaultConfig });

      // Generate a unique name for this configuration

      // Check if there are existing configurations for this provider
      const existingConfigsForProvider = savedConfigs?.providers?.filter(
        p => p.providerId === providerId
      );

      if (existingConfigsForProvider && existingConfigsForProvider.length > 0) {
        // Find the highest number used in existing configurations
        let maxNumber = 0;
        const regex = new RegExp(`^${providerName}\\s+(\\d+)$`);

        existingConfigsForProvider.forEach(p => {
          if (p.displayName) {
            const match = p.displayName.match(regex);
            if (match && match[1]) {
              const num = parseInt(match[1], 10);
              if (!isNaN(num) && num > maxNumber) {
                maxNumber = num;
              }
            }
          }
        });

        // Use the next available number
        setDialogConfigName(`${providerName} ${maxNumber + 1}`);
      } else {
        // Use the provider name as the initial configuration name for the first instance
        setDialogConfigName(providerName);
      }
    }

    setDialogOpen(true);
  };

  // Handle dialog close
  const handleCloseDialog = () => {
    setDialogOpen(false);
  };

  // Handle saving config from dialog
  const handleSaveDialog = (makeDefault: boolean) => {
    // Apply the changes from dialog to the main config
    handleProviderChange(dialogProviderId);
    handleConfigChange(dialogConfig);
    handleConfigNameChange(dialogConfigName);

    // Save the configuration - also pass the display name
    handleSaveConfig(dialogProviderId, dialogConfig, makeDefault, dialogConfigName);

    // Close dialog
    setDialogOpen(false);
  };

  // Handle dialog config change
  const handleDialogConfigChange = (newConfig: Record<string, any>) => {
    setDialogConfig(newConfig);
  };

  // Handle dialog config name change
  const handleDialogConfigNameChange = (name: string) => {
    setDialogConfigName(name);
  };

  // Handle provider selection from the provider selection dialog
  const handleProviderSelection = (providerId: string) => {
    setProviderSelectionOpen(false);
    // Always treat selection from the provider dialog as a new configuration
    handleOpenDialog(providerId, true);
  };

  const handleAddProviderClick = () => {
    // Check if this is the first provider and terms haven't been accepted
    const isFirstProvider = !savedConfigs?.providers?.length;

    if (isFirstProvider && !hasAcceptedTerms()) {
      setTermsDialogOpen(true);
    } else {
      setDetectAllStatus(null);
      setProviderSelectionOpen(true);
    }
  };

  const handleTermsAccept = () => {
    acceptTerms();
    setTermsDialogOpen(false);
    setDetectAllStatus(null);
    setProviderSelectionOpen(true);
  };

  const handleTermsClose = () => {
    setTermsDialogOpen(false);
  };

  const handleCloseMenu = () => {
    setAnchorEl(null);
  };

  /**
   * Runs auto-detection for a single provider by ID.
   *
   * Delegates to the appropriate provider-specific detector:
   * - `'copilot'` → {@link detectCopilotProvider}
   * - `'azure'` → {@link collectAzureOpenAIProviders}
   * - `'local'` → {@link detectOllamaProvider}
   *
   * @param providerId - The provider ID to detect.
   * @returns The detected provider config, or `null` if detection failed or
   *   the provider ID is not supported.
   */
  const handleDetectSingleProvider = async (
    providerId: string
  ): Promise<DetectedProvider | null> => {
    if (providerId === 'copilot') {
      return detectCopilotProvider();
    }
    if (providerId === 'azure') {
      const normalizeEndpoint = (url: string) => url.trim().toLowerCase().replace(/\/+$/, '');
      const savedAzureAccountNames = new Set(
        (savedConfigs?.providers || [])
          .filter(p => p.providerId === 'azure' && p.config?.azAccountName)
          .map(p => p.config.azAccountName as string)
      );
      const savedAzureEndpoints = new Set(
        (savedConfigs?.providers || [])
          .filter(p => p.providerId === 'azure' && p.config?.endpoint)
          .map(p => normalizeEndpoint(p.config.endpoint as string))
      );
      const all = await collectAzureOpenAIProviders(savedAzureAccountNames, savedAzureEndpoints);

      if (all.length === 0) return null;
      // Always close the config form and route to the picker — even for a
      // single account — so the user can review and confirm before saving.
      setDialogOpen(false);
      if (onAutoDetectResults) onAutoDetectResults(all);
      return null;
    }
    if (providerId === 'local') {
      return detectOllamaProvider();
    }
    return null;
  };

  const handleDetectAllProviders = async () => {
    setIsDetectingAllProviders(true);
    setDetectAllStatus(null);

    try {
      const detected = await detectProviders(savedConfigs?.providers || []);

      if (detected.length > 0) {
        setProviderSelectionOpen(false);
        if (onAutoDetectResults) {
          onAutoDetectResults(detected);
        }
      } else {
        const ghAvailable = await detectGhCliAvailable();
        setDetectAllStatus({
          kind: 'error',
          text: t('No new providers were detected in your environment.'),
          hint: ghAvailable ? undefined : <GhNotInstalledHint t={t} />,
        });
      }
    } catch {
      setDetectAllStatus({
        kind: 'error',
        text: t('Auto-detection failed unexpectedly. Please try again.'),
      });
    } finally {
      setIsDetectingAllProviders(false);
    }
  };

  // Menu handling

  // Handle provider change internally
  const handleProviderChange = (providerId: string) => {
    // Try to find an existing config for this provider
    const existingConfig = savedConfigs?.providers?.find(p => p.providerId === providerId);

    if (existingConfig) {
      // Use existing config
      if (onChange) {
        onChange({
          providerId,
          config: { ...existingConfig.config },
          displayName: existingConfig.displayName || '',
        });
      }
    } else {
      // Reset config to defaults when changing to a new provider
      if (onChange) {
        onChange({
          providerId,
          config: getDefaultConfig(providerId),
          displayName: '',
        });
      }
    }
  };

  // Handle configuration changes internally
  const handleConfigChange = (newConfig: Record<string, any>) => {
    if (onChange) {
      onChange({
        providerId: selectedProvider,
        config: newConfig,
        displayName: configName,
      });
    }
  };

  // Handle saving a configuration internally
  const handleSaveConfig = (
    providerId: string,
    config: Record<string, any>,
    makeDefault: boolean,
    displayName?: string
  ) => {
    // Save the configuration with the display name from dialog or existing one
    const updatedConfigs = saveProviderConfig(
      savedConfigs,
      providerId,
      config,
      makeDefault,
      displayName || configName
    );

    // Notify parent of changes
    if (onChange) {
      onChange({
        providerId,
        config,
        displayName: displayName || configName,
        savedConfigs: updatedConfigs,
      });
    }
  };

  // Handle selecting a saved configuration internally
  const handleSelectSavedConfig = (config: StoredProviderConfig) => {
    if (onChange) {
      onChange({
        providerId: config.providerId,
        config: { ...config.config },
        displayName: config.displayName || '',
      });
    }
  };

  // Handle config name changes internally
  const handleConfigNameChange = (name: string) => {
    if (onChange) {
      onChange({
        providerId: selectedProvider,
        config,
        displayName: name,
      });
    }
  };

  // Handle deleting a config internally
  const handleDeleteConfig = (providerId: string, configToDelete: Record<string, any>) => {
    const updatedConfigs = deleteProviderConfig(savedConfigs, providerId, configToDelete);

    // If we're deleting the currently active config, we need to update our local state
    if (
      providerId === selectedProvider &&
      isSameStoredConfig(
        { providerId, config: configToDelete },
        { providerId: selectedProvider, config }
      )
    ) {
      // Find the new active provider
      const newActiveConfig = getActiveConfig(updatedConfigs);
      if (newActiveConfig && onChange) {
        onChange({
          providerId: newActiveConfig.providerId,
          config: { ...newActiveConfig.config },
          displayName: newActiveConfig.displayName || '',
          savedConfigs: updatedConfigs,
        });
      } else if (onChange) {
        // No configs left, reset to defaults
        onChange({
          providerId: 'openai',
          config: getDefaultConfig('openai'),
          displayName: '',
          savedConfigs: updatedConfigs,
        });
      }
    } else if (onChange) {
      // Not deleting the active config, just update the saved configs
      onChange({
        providerId: selectedProvider,
        config,
        displayName: configName,
        savedConfigs: updatedConfigs,
      });
    }
  };

  return (
    <Box sx={{ width: '100%' }}>
      {/* Configured Providers Section */}
      <Box sx={{ mb: 4 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="subtitle1">
            {!savedConfigs?.providers?.length
              ? t('No Configured Providers')
              : t('Configured Providers')}
          </Typography>
          <Button
            variant="contained"
            color="primary"
            startIcon={<Icon icon="mdi:plus-circle" />}
            onClick={handleAddProviderClick}
          >
            {t('Add Provider')}
          </Button>
        </Box>

        {!savedConfigs?.providers?.length ? (
          <Paper
            sx={{
              p: 3,
              mb: 3,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              borderStyle: 'dashed',
              borderWidth: 1,
              borderColor: 'divider',
            }}
          >
            <Icon
              icon="mdi:robot-confused"
              width="48px"
              height="48px"
              style={{ opacity: 0.6 }}
              aria-hidden="true"
              focusable="false"
            />
            <Typography variant="body1" sx={{ mt: 2, mb: 1 }}>
              {t('No AI providers configured yet')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              {t('Click "Add Provider" to configure your first AI provider')}
            </Typography>
          </Paper>
        ) : (
          <Grid container spacing={2}>
            {savedConfigs?.providers?.map((savedConfig, index) => {
              const isActive =
                savedConfig.providerId === selectedProvider &&
                isSameStoredConfig(savedConfig, { providerId: selectedProvider, config });

              // Find provider info for icon
              const savedProvider = getProviderById(savedConfig.providerId);

              return (
                <Grid item key={index} xs={6} md={4} lg={3}>
                  <Paper
                    component={isConfigView ? 'div' : 'button'}
                    elevation={isActive ? 3 : 1}
                    aria-pressed={!isConfigView ? isActive : undefined}
                    sx={{
                      p: 2,
                      cursor: isConfigView ? 'default' : 'pointer',
                      border: isActive ? '2px solid' : '1px solid',
                      borderColor: isActive ? 'primary.main' : 'divider',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      position: 'relative',
                      transition: 'all 0.2s',
                      width: isConfigView ? undefined : '100%',
                      background: isConfigView ? undefined : 'inherit',
                      font: isConfigView ? undefined : 'inherit',
                      '&:hover': {
                        borderColor: 'primary.light',
                        boxShadow: isConfigView ? 0 : 1,
                      },
                    }}
                    onClick={() => {
                      if (!isConfigView) {
                        handleSelectSavedConfig(savedConfig);
                      }
                    }}
                  >
                    <Box
                      sx={{
                        width: '100%',
                        display: 'flex',
                        justifyContent: 'space-between',
                        mb: 1,
                      }}
                    >
                      <Box>
                        {savedConfigs && index === (savedConfigs.defaultProviderIndex ?? 0) && (
                          <Chip
                            label={t('Default')}
                            size="small"
                            color="primary"
                            sx={{ fontSize: '0.7rem' }}
                          />
                        )}
                      </Box>
                      <IconButton
                        size="small"
                        aria-label={t('More options for {{name}}', {
                          name:
                            savedConfig.displayName ||
                            getProviderById(savedConfig.providerId)?.name ||
                            savedConfig.providerId,
                        })}
                        onClick={e => {
                          e.stopPropagation();
                          setAnchorEl(e.currentTarget);
                          setSelectedConfigIndex(index);
                        }}
                      >
                        <Icon
                          icon="mdi:dots-vertical"
                          width="16px"
                          aria-hidden="true"
                          focusable="false"
                        />
                      </IconButton>
                    </Box>

                    <Icon
                      icon={savedProvider?.icon || 'mdi:robot'}
                      width="32px"
                      height="32px"
                      style={{ marginBottom: '8px' }}
                      aria-hidden="true"
                      focusable="false"
                    />
                    <Typography variant="body1" sx={{ fontWeight: 'medium', textAlign: 'center' }}>
                      {savedConfig.displayName || savedProvider?.name || savedConfig.providerId}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" align="center">
                      {savedConfig.config.model || savedConfig.config.deploymentName ? (
                        <Box>
                          {savedConfig.config.model
                            ? getModelDisplayName(savedConfig.config.model)
                            : savedConfig.config.deploymentName}
                          {savedConfig.config.showOnlyThisModel && (
                            <Box
                              component="span"
                              sx={{ color: 'primary.main', fontWeight: 'medium' }}
                            >
                              {' • '}
                              {t('Only this model')}
                            </Box>
                          )}
                        </Box>
                      ) : (
                        t('Configuration')
                      )}
                    </Typography>

                    <Menu anchorEl={anchorEl} open={openMenu} onClose={handleCloseMenu}>
                      <MenuItem
                        onClick={e => {
                          e.stopPropagation();
                          handleCloseMenu();
                          if (
                            selectedConfigIndex !== null &&
                            savedConfigs?.providers[selectedConfigIndex]
                          ) {
                            const selectedSavedConfig =
                              savedConfigs?.providers[selectedConfigIndex];
                            // Use false for isNewConfig to indicate we're editing an existing config
                            handleOpenDialog(selectedSavedConfig.providerId, false);
                            // Pre-select this saved config
                            setDialogConfig({ ...selectedSavedConfig.config });
                            setDialogConfigName(selectedSavedConfig.displayName || '');
                          }
                        }}
                      >
                        <Icon
                          icon="mdi:pencil"
                          width="16px"
                          style={{ marginRight: 8 }}
                          aria-hidden="true"
                          focusable="false"
                        />
                        {t('Edit')}
                      </MenuItem>
                      <MenuItem
                        onClick={e => {
                          e.stopPropagation();
                          handleCloseMenu();
                          // Handle make default action using selectedConfigIndex
                          if (
                            selectedConfigIndex !== null &&
                            savedConfigs?.providers[selectedConfigIndex]
                          ) {
                            const selectedSavedConfig = savedConfigs.providers[selectedConfigIndex];
                            handleProviderChange(selectedSavedConfig.providerId);
                            handleConfigChange(selectedSavedConfig.config);
                            // Pass the display name to ensure we're setting the correct config as default
                            handleSaveConfig(
                              selectedSavedConfig.providerId,
                              selectedSavedConfig.config,
                              true,
                              selectedSavedConfig.displayName
                            );
                          }
                        }}
                      >
                        <Icon
                          icon="mdi:star"
                          width="16px"
                          style={{ marginRight: 8 }}
                          aria-hidden="true"
                          focusable="false"
                        />
                        {t('Make Default')}
                      </MenuItem>
                      <MenuItem
                        onClick={e => {
                          e.stopPropagation();
                          handleCloseMenu();
                          // Handle delete action using selectedConfigIndex
                          if (
                            selectedConfigIndex !== null &&
                            savedConfigs?.providers[selectedConfigIndex]
                          ) {
                            setShowDeleteConfirm(true);
                          }
                        }}
                        sx={{ color: 'error.main' }}
                      >
                        <Icon
                          icon="mdi:trash-can"
                          width="16px"
                          style={{ marginRight: 8 }}
                          aria-hidden="true"
                          focusable="false"
                        />
                        {t('Delete')}
                      </MenuItem>
                    </Menu>
                  </Paper>
                </Grid>
              );
            })}
          </Grid>
        )}
      </Box>

      {/* Detected Providers Picker */}

      {/* Terms Dialog */}
      <TermsDialog open={termsDialogOpen} onClose={handleTermsClose} onAccept={handleTermsAccept} />

      {/* Provider Selection Dialog */}
      <ProviderSelectionDialog
        open={providerSelectionOpen}
        onClose={() => setProviderSelectionOpen(false)}
        onSelectProvider={handleProviderSelection}
        onDetectAll={handleDetectAllProviders}
        isDetectingAll={isDetectingAllProviders}
        detectAllStatus={detectAllStatus}
      />

      {/* Configuration Dialog */}
      <ConfigurationDialog
        open={dialogOpen}
        onClose={handleCloseDialog}
        providerId={dialogProviderId}
        config={dialogConfig}
        onConfigChange={handleDialogConfigChange}
        configName={dialogConfigName}
        onConfigNameChange={handleDialogConfigNameChange}
        onSave={handleSaveDialog}
        onDetectProvider={handleDetectSingleProvider}
      />

      <ConfirmDialog
        // @ts-ignore - 'open' property is not in the type definition but is required
        open={showDeleteConfirm}
        handleClose={() => {
          setShowDeleteConfirm(false);
          setSelectedConfigIndex(null);
        }}
        onConfirm={() => {
          if (selectedConfigIndex !== null && savedConfigs?.providers[selectedConfigIndex]) {
            const selectedSavedConfig = savedConfigs.providers[selectedConfigIndex];
            handleDeleteConfig(selectedSavedConfig.providerId, selectedSavedConfig.config);
          }
        }}
        title={t('Delete Configuration')}
        description={t('Are you sure you want to delete this configuration?')}
        cancelLabel={t('Cancel')}
        confirmLabel={t('Delete')}
      />
    </Box>
  );
}
