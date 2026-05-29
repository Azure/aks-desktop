import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { getProviderById } from '../../config/modelConfig';
import type { DetectedProvider } from '../../utils/providerAutoDetect';

interface DetectedProvidersDialogProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Providers discovered by auto-detection that the user can choose to add. */
  detectedProviders: DetectedProvider[];
  /** Called with the subset of providers the user selected when they click "Add Selected". */
  onConfirm: (selected: DetectedProvider[]) => void;
  /** Called when the user dismisses the dialog without adding any providers. */
  onDismiss: () => void;
}

export default function DetectedProvidersDialog({
  open,
  detectedProviders,
  onConfirm,
  onDismiss,
}: DetectedProvidersDialogProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(detectedProviders.map((_, i) => i))
  );

  // Reset selection whenever the dialog opens or detectedProviders changes
  useEffect(() => {
    if (open) {
      setSelected(new Set(detectedProviders.map((_, i) => i)));
    }
  }, [open, detectedProviders]);

  const handleToggle = (index: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const handleConfirm = () => {
    const selectedProviders = detectedProviders.filter((_, i) => selected.has(i));
    onConfirm(selectedProviders);
  };

  return (
    <Dialog open={open} onClose={onDismiss} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" gap={1}>
          <Icon icon="mdi:auto-fix" width="24px" height="24px" />
          <Typography variant="h6">{t('AI Providers Detected')}</Typography>
        </Box>
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
          {t(
            'We detected AI providers available in your environment. Select the ones you want to add to your AI Assistant configuration.'
          )}
        </Typography>

        {detectedProviders.map((provider, index) => {
          const providerDef = getProviderById(provider.providerId);
          return (
            <FormControlLabel
              key={provider.providerId}
              control={
                <Checkbox checked={selected.has(index)} onChange={() => handleToggle(index)} />
              }
              label={
                <Box display="flex" alignItems="center">
                  {providerDef && (
                    <Icon
                      icon={providerDef.icon}
                      width="28px"
                      height="28px"
                      style={{ marginRight: 12, flexShrink: 0 }}
                    />
                  )}
                  <Box>
                    <Typography variant="body1" fontWeight="medium">
                      {provider.displayName}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t('Detected via {{source}}', { source: provider.source })}
                    </Typography>
                  </Box>
                </Box>
              }
              sx={{
                display: 'flex',
                alignItems: 'center',
                m: 0,
                mb: 1,
                p: 1.5,
                border: '1px solid',
                borderColor: selected.has(index) ? 'primary.main' : 'divider',
                borderRadius: 1,
                transition: 'border-color 0.2s',
                '&:hover': {
                  borderColor: 'primary.light',
                },
                '& .MuiFormControlLabel-label': {
                  flex: 1,
                },
              }}
            />
          );
        })}
      </DialogContent>
      <DialogActions>
        <Button onClick={onDismiss}>{t('Not Now')}</Button>
        <Button variant="contained" onClick={handleConfirm} disabled={selected.size === 0}>
          {t('Add Selected')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
