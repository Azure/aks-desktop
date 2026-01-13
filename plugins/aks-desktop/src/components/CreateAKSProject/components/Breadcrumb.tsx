// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { Box, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import React from 'react';
import type { BreadcrumbProps } from '../types';

/**
 * Breadcrumb navigation component for multi-step forms
 */
export const Breadcrumb: React.FC<BreadcrumbProps> = ({ steps, activeStep, onStepClick }) => {
  const theme = useTheme();

  return (
    <Box
      sx={{
        width: '100%',
        borderBottom: `1px solid ${theme.palette.divider}`,
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'flex-start',
        alignItems: 'center',
        backgroundColor: theme.palette.background.muted,
        px: 3,
        py: 2,
      }}
    >
      {steps.map((label, index) => (
        <React.Fragment key={label}>
          <Box
            onClick={() => onStepClick(index)}
            sx={{
              display: 'flex',
              alignItems: 'center',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              '&:hover': { opacity: 0.8 },
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
              <Icon
                icon={
                  index === activeStep
                    ? `mdi:numeric-${index + 1}-circle`
                    : `mdi:numeric-${index + 1}-circle-outline`
                }
                width={24}
                height={24}
                color={index === activeStep ? 'primary.main' : 'text.secondary'}
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
          </Box>

          {index < steps.length - 1 && (
            <Typography variant="body1" sx={{ mx: 2, color: 'text.secondary' }}>
              &gt;
            </Typography>
          )}
        </React.Fragment>
      ))}
    </Box>
  );
};
