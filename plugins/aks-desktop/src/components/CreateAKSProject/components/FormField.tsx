// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { styled } from '@mui/material';
import { InputAdornment, TextField } from '@mui/material';
import React from 'react';
import { FormFieldProps } from '../types';

const PREFIX = 'FormField';

const classes = {
  textField: `${PREFIX}-textField`,
};

const StyledInputAdornment = styled(InputAdornment)(({ theme }) => ({
  [`& .${classes.textField}`]: {
    '& .MuiOutlinedInput-root': {
      '& fieldset': {
        borderColor: theme.palette.divider,
      },
      '&:hover fieldset': {
        borderColor: theme.palette.primary.main,
      },
      '&.Mui-focused fieldset': {
        borderColor: theme.palette.primary.main,
      },
    },
    '& .MuiInputLabel-root': {
      color: theme.palette.text.secondary,
      '&.Mui-focused': {
        color: theme.palette.primary.main,
      },
    },
  },
}));

/**
 * Reusable form field component with consistent styling
 */
export const FormField: React.FC<FormFieldProps> = ({
  label,
  value,
  onChange,
  type = 'text',
  multiline = false,
  rows = 1,
  placeholder,
  error = false,
  helperText,
  disabled = false,
  required = false,
  startAdornment,
  endAdornment,
}) => {
  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (type === 'number') {
      const numValue = parseFloat(event.target.value) || 0;
      // Prevent negative values for number inputs
      const validValue = Math.max(0, numValue);
      onChange(validValue);
    } else {
      onChange(event.target.value);
    }
  };

  const handleBlur = () => {
    // Auto-trim text inputs on blur for better UX (except for textarea/multiline)
    if (type === 'text' && !multiline && typeof value === 'string') {
      const trimmedValue = value.trim();
      if (trimmedValue !== value) {
        onChange(trimmedValue);
      }
    }
  };

  return (
    <TextField
      variant="outlined"
      label={label}
      value={value}
      onChange={handleChange}
      onBlur={handleBlur}
      type={type}
      multiline={multiline}
      rows={multiline ? rows : undefined}
      placeholder={placeholder}
      error={error}
      helperText={helperText}
      disabled={disabled}
      required={required}
      fullWidth
      className={classes.textField}
      inputProps={{
        min: type === 'number' ? 0 : undefined,
        step: type === 'number' ? 'any' : undefined,
      }}
      InputProps={{
        startAdornment: startAdornment ? (
          <StyledInputAdornment position="start">{startAdornment}</StyledInputAdornment>
        ) : undefined,
        endAdornment: endAdornment ? (
          <InputAdornment position="end">{endAdornment}</InputAdornment>
        ) : undefined,
      }}
    />
  );
};

export default FormField;
