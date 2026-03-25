// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import React, { useEffect, useState } from 'react';
import {
  ACR_NAME_ERROR,
  ACR_NAME_PATTERN,
  createContainerRegistry,
} from '../../../utils/azure/az-acr';
import {
  type AcrInfo,
  type AcrSku,
  getContainerRegistries,
  getResourceGroupLocation,
} from '../../../utils/azure/az-cli';

export interface AcrSelection {
  acrResourceId: string;
  acrLoginServer: string;
}

interface AcrSelectorProps {
  subscriptionId: string;
  resourceGroup: string;
  onSelect: (selection: AcrSelection | null) => void;
  /** Current selection, if any. */
  value: AcrSelection | null;
}

const CREATE_NEW_VALUE = '__create_new__';
const SKIP_VALUE = '__skip__';

export function AcrSelector({ subscriptionId, resourceGroup, onSelect, value }: AcrSelectorProps) {
  const { t } = useTranslation();
  const [registries, setRegistries] = useState<AcrInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedValue, setSelectedValue] = useState<string>(value ? value.acrResourceId : '');
  const [mode, setMode] = useState<'selecting' | 'creating' | 'skipped'>('selecting');

  // Sync selectedValue from props when an actual ACR is selected externally.
  // Don't reset to '' when value is null — the user may be in creating/skipped mode.
  useEffect(() => {
    if (value) {
      setSelectedValue(value.acrResourceId);
      setMode('selecting');
    }
  }, [value]);

  // Create form state
  const [newRegistryName, setNewRegistryName] = useState('');
  const [newRegistrySku, setNewRegistrySku] = useState<AcrSku>('Basic');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await getContainerRegistries(subscriptionId);
        if (!cancelled) setRegistries(result);
      } catch (err) {
        console.error('Failed to load container registries:', err);
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Failed to load container registries');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [subscriptionId]);

  const handleSelectChange = (newValue: string) => {
    setSelectedValue(newValue);

    if (newValue === CREATE_NEW_VALUE) {
      setMode('creating');
      onSelect(null);
    } else if (newValue === SKIP_VALUE) {
      setMode('skipped');
      onSelect(null);
    } else {
      setMode('selecting');
      const registry = registries.find(r => r.id === newValue);
      if (registry) {
        onSelect({ acrResourceId: registry.id, acrLoginServer: registry.loginServer });
      } else {
        console.warn(`Selected registry ${newValue} not found in loaded registries`);
        onSelect(null);
      }
    }
  };

  const handleCreateRegistry = async () => {
    const trimmed = newRegistryName.trim();
    if (!trimmed) return;

    if (!ACR_NAME_PATTERN.test(trimmed)) {
      setCreateError(t(ACR_NAME_ERROR));
      return;
    }

    setCreating(true);
    setCreateError(null);

    try {
      const location = await getResourceGroupLocation({
        resourceGroupName: resourceGroup,
        subscriptionId,
      });

      const result = await createContainerRegistry({
        registryName: trimmed,
        resourceGroup,
        subscriptionId,
        location,
        sku: newRegistrySku,
      });

      if (!result.success || !result.id || !result.loginServer) {
        throw new Error(result.error ?? t('Failed to create container registry'));
      }

      const newAcr: AcrInfo = {
        id: result.id,
        name: trimmed,
        resourceGroup,
        loginServer: result.loginServer,
        location,
        sku: newRegistrySku,
      };

      setRegistries(prev => [...prev, newAcr]);
      setSelectedValue(result.id);
      setMode('selecting');
      onSelect({ acrResourceId: result.id, acrLoginServer: result.loginServer });
    } catch (err) {
      console.error('Failed to create container registry:', err);
      setCreateError(err instanceof Error ? err.message : t('Failed to create container registry'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Icon icon="mdi:docker" width={24} height={24} />
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          {t('Container Registry')}
        </Typography>
      </Box>

      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        {t(
          'Select an Azure Container Registry for building and pushing container images, or create a new one.'
        )}
      </Typography>

      {loading ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 2 }}>
          <CircularProgress size={20} />
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('Loading container registries...')}
          </Typography>
        </Box>
      ) : error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : (
        <>
          <FormControl fullWidth size="small" sx={{ mb: 2 }}>
            <InputLabel>{t('Container Registry')}</InputLabel>
            <Select
              value={selectedValue}
              onChange={e => handleSelectChange(e.target.value)}
              label={t('Container Registry')}
            >
              {registries.map(reg => (
                <MenuItem key={reg.id} value={reg.id}>
                  {reg.name} ({reg.loginServer})
                </MenuItem>
              ))}
              <MenuItem value={CREATE_NEW_VALUE}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Icon icon="mdi:plus" width={18} height={18} />
                  {t('Create new registry')}
                </Box>
              </MenuItem>
              <MenuItem value={SKIP_VALUE}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Icon icon="mdi:skip-next" width={18} height={18} />
                  {t('Skip (configure manually later)')}
                </Box>
              </MenuItem>
            </Select>
          </FormControl>

          {mode === 'skipped' && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {t(
                'Without a container registry, the pipeline cannot build and push container images. You will need to configure a registry manually.'
              )}
            </Alert>
          )}

          {mode === 'creating' && (
            <Box sx={{ pl: 2, borderLeft: 2, borderColor: 'divider', mb: 2 }}>
              <TextField
                label={t('Registry Name')}
                size="small"
                value={newRegistryName}
                onChange={e => setNewRegistryName(e.target.value)}
                fullWidth
                helperText={t('Globally unique name. 5-50 alphanumeric characters.')}
                sx={{ mb: 2 }}
              />

              <FormControl size="small" sx={{ mb: 2, minWidth: 200 }}>
                <InputLabel>{t('SKU')}</InputLabel>
                <Select
                  value={newRegistrySku}
                  onChange={e => setNewRegistrySku(e.target.value as AcrSku)}
                  label={t('SKU')}
                >
                  <MenuItem value="Basic">{t('Basic')}</MenuItem>
                  <MenuItem value="Standard">{t('Standard')}</MenuItem>
                  <MenuItem value="Premium">{t('Premium')}</MenuItem>
                </Select>
              </FormControl>

              {createError && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {createError}
                </Alert>
              )}

              <Button
                variant="contained"
                onClick={handleCreateRegistry}
                disabled={!newRegistryName.trim() || creating}
                startIcon={
                  creating ? (
                    <CircularProgress size={16} />
                  ) : (
                    <Icon icon="mdi:plus" aria-hidden="true" />
                  )
                }
                sx={{ textTransform: 'none' }}
              >
                {creating ? t('Creating...') : t('Create Registry')}
              </Button>
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
