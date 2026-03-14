// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Alert, Box, Button, IconButton, Typography } from '@mui/material';
import React, { useState } from 'react';

interface WizardShellProps {
  activeStep: 0 | 1 | 2;
  onClose: () => void;
  onCancel?: () => void;
  children: React.ReactNode;
  footerActions?: React.ReactNode;
}

function StepIndicator({
  index,
  label,
  isActive,
  isCompleted,
}: {
  index: number;
  label: string;
  isActive: boolean;
  isCompleted: boolean;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Box
        sx={{
          width: 24,
          height: 24,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
          fontWeight: 600,
          ...(isActive || isCompleted
            ? { bgcolor: 'primary.main', color: 'primary.contrastText' }
            : { border: '1.5px solid', borderColor: 'text.disabled', color: 'text.disabled' }),
        }}
      >
        {isCompleted ? <Box component={Icon} icon="mdi:check" sx={{ fontSize: 16 }} /> : index + 1}
      </Box>
      <Typography
        variant="body2"
        sx={{
          fontWeight: isActive ? 600 : 400,
          color: isActive || isCompleted ? 'text.primary' : 'text.disabled',
        }}
      >
        {label}
      </Typography>
    </Box>
  );
}

export function WizardShell({
  activeStep,
  onClose,
  onCancel,
  children,
  footerActions,
}: WizardShellProps) {
  const { t } = useTranslation();
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const steps = [t('Connect Source'), t('Set up Copilot Agent'), t('Review & Merge')];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ px: 3, pt: 3, pb: 2, flexShrink: 0 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 600 }}>
              {t('Configure Pipeline')}
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
              {t(
                'Set up a CI/CD pipeline to automate your deployments and streamline your workflow'
              )}
            </Typography>
          </Box>
          <IconButton onClick={onClose} size="small" aria-label={t('Collapse panel')}>
            <Icon icon="mdi:chevron-double-right" aria-hidden="true" />
          </IconButton>
        </Box>

        {/* Stepper */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 2.5 }}>
          {steps.map((label, i) => (
            <React.Fragment key={i}>
              {i > 0 && (
                <Box
                  component={Icon}
                  icon="mdi:chevron-right"
                  sx={{ fontSize: 18, color: 'text.disabled', flexShrink: 0 }}
                />
              )}
              <StepIndicator
                index={i}
                label={label}
                isActive={activeStep === i}
                isCompleted={i < activeStep}
              />
            </React.Fragment>
          ))}
        </Box>
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, overflow: 'auto', px: 3, py: 2 }}>
        {showCancelConfirm ? (
          <Alert
            severity="warning"
            sx={{ mt: 2 }}
            action={
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button
                  size="small"
                  onClick={() => setShowCancelConfirm(false)}
                  sx={{ textTransform: 'none' }}
                >
                  {t('Keep Going')}
                </Button>
                <Button
                  size="small"
                  color="error"
                  variant="contained"
                  onClick={() => onCancel?.()}
                  sx={{ textTransform: 'none' }}
                >
                  {t('Discard')}
                </Button>
              </Box>
            }
          >
            {t('Canceling will discard your pipeline progress. Are you sure?')}
          </Alert>
        ) : (
          children
        )}
      </Box>

      {/* Footer */}
      {(footerActions || onCancel) && !showCancelConfirm && (
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            px: 3,
            py: 2,
            borderTop: '1px solid',
            borderColor: 'divider',
            flexShrink: 0,
          }}
        >
          <Box sx={{ display: 'flex', gap: 1.5 }}>{footerActions}</Box>
          {onCancel ? (
            <Button
              size="small"
              color="inherit"
              onClick={() => setShowCancelConfirm(true)}
              sx={{ textTransform: 'none', color: 'text.secondary', fontSize: '0.8rem' }}
            >
              {t('Cancel')}
            </Button>
          ) : (
            <Box />
          )}
        </Box>
      )}
    </Box>
  );
}
