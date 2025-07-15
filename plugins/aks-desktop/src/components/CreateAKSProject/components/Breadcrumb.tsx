// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { styled } from '@mui/material';
import { Box, Typography } from '@mui/material';
import React from 'react';
import { BreadcrumbProps } from '../types';

const PREFIX = 'Breadcrumb';

const classes = {
  breadcrumbSection: `${PREFIX}-breadcrumbSection`,
  breadcrumbItem: `${PREFIX}-breadcrumbItem`,
  breadcrumbIcon: `${PREFIX}-breadcrumbIcon`,
  breadcrumbText: `${PREFIX}-breadcrumbText`,
  breadcrumbSeparator: `${PREFIX}-breadcrumbSeparator`,
};

const StyledBox = styled(Box)(({ theme }: any) => ({
  [`&.${classes.breadcrumbSection}`]: {
    width: '100%',
    borderBottom: `1px solid ${theme.palette.divider}`,
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    backgroundColor: theme.palette.background.muted,
    padding: theme.spacing(2, 3),
  },

  [`& .${classes.breadcrumbItem}`]: {
    display: 'flex',
    alignItems: 'center',
    cursor: 'pointer',
    '&:hover': {
      opacity: 0.8,
    },
    transition: 'all 0.2s ease',
  },

  [`& .${classes.breadcrumbIcon}`]: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing(2),
  },

  [`& .${classes.breadcrumbText}`]: {
    color: theme.palette.text.secondary,
    fontWeight: 'normal',
    textDecoration: 'none',
    '&.active': {
      color: theme.palette.primary.main,
      fontWeight: 'bold',
      textDecoration: 'underline',
      textUnderlineOffset: '4px',
    },
  },

  [`& .${classes.breadcrumbSeparator}`]: {
    margin: theme.spacing(0, 2),
    color: theme.palette.text.secondary,
  },
}));

/**
 * Breadcrumb navigation component for multi-step forms
 */
export const Breadcrumb: React.FC<BreadcrumbProps> = ({ steps, activeStep, onStepClick }) => {
  return (
    <StyledBox className={classes.breadcrumbSection}>
      {steps.map((label, index) => (
        <React.Fragment key={label}>
          <Box onClick={() => onStepClick(index)} className={classes.breadcrumbItem}>
            <Box className={classes.breadcrumbIcon}>
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
              className={`${classes.breadcrumbText} ${index === activeStep ? 'active' : ''}`}
            >
              {label}
            </Typography>
          </Box>
          {index < steps.length - 1 && (
            <Typography variant="body1" className={classes.breadcrumbSeparator}>
              &gt;
            </Typography>
          )}
        </React.Fragment>
      ))}
    </StyledBox>
  );
};

export default Breadcrumb;
