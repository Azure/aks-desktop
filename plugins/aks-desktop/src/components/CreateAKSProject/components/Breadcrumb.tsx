// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Box, Typography, useTheme } from '@mui/material';
import React from 'react';
import type { BreadcrumbProps } from '../types';

/**
 * Breadcrumb navigation component for multi-step forms.
 */
export const Breadcrumb: React.FC<BreadcrumbProps> = ({ steps, activeStep, onStepClick }) => {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Box
      role="navigation"
      aria-label={t('Wizard steps')}
      sx={theme => ({
        width: '100%',
        borderBottom: `1px solid ${theme.palette.divider}`,
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'flex-start',
        alignItems: 'center',
        // @ts-ignore todo: fix this
        backgroundColor: theme.palette.background.muted,
        flexWrap: 'wrap',
        gap: 1,
        px: 3,
        py: 2,
      })}
    >
      {steps.map((label, index) => (
        <React.Fragment key={index}>
          <Box
            role="button"
            tabIndex={0}
            aria-current={index === activeStep ? 'step' : undefined}
            onClick={() => onStepClick(index)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onStepClick(index);
              }
            }}
            sx={{
              display: 'flex',
              alignItems: 'center',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              borderRadius: 1,
              '&:hover': { opacity: 0.8 },
              /* Visible focus ring for keyboard navigation — ensures keyboard
                 users can see which breadcrumb step is currently focused.
                 :focus-visible targets only keyboard (not mouse) focus so that
                 mouse users don't see an outline on click.
                 MDN: https://developer.mozilla.org/en-US/docs/Web/CSS/:focus-visible */
              '&:focus-visible': {
                outline: `2px solid ${theme.palette.primary.main}`,
                outlineOffset: '2px',
              },
            }}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                mr: 2,
              }}
            >
              {/* aria-hidden: decorative step-number icon — the adjacent text label
                  already conveys the step name to screen readers */}
              <Icon
                icon={
                  index === activeStep
                    ? `mdi:numeric-${index + 1}-circle`
                    : `mdi:numeric-${index + 1}-circle-outline`
                }
                width={24}
                height={24}
                color={index === activeStep ? 'primary.main' : 'text.secondary'}
                aria-hidden="true"
              />
            </Box>

            <Typography
              variant="body1"
              sx={{
                color: index === activeStep ? 'primary.main' : 'text.secondary',
                fontWeight: index === activeStep ? 'bold' : 'normal',
                textDecoration: index === activeStep ? 'underline' : 'none',
                textUnderlineOffset: index === activeStep ? '4px' : undefined,
              }}
            >
              {label}
            </Typography>

            {index < steps.length - 1 && (
              <Typography
                variant="body1"
                sx={{ ml: 1, color: 'text.secondary' }}
                aria-hidden="true"
              >
                &gt;
              </Typography>
            )}
          </Box>
        </React.Fragment>
      ))}
    </Box>
  );
};
