// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { InputAdornment, TextField } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import React from 'react';

export interface FormFieldProps {
  label: string;
  value: string | number;
  onChange: (value: string | number) => void;
  type?: 'text' | 'email' | 'number' | 'textarea';
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  error?: boolean;
  helperText?: string;
  disabled?: boolean;
  required?: boolean;
  startAdornment?: React.ReactNode;
  endAdornment?: React.ReactNode;
  /** Ref for the input element of this field */
  inputRef?: React.Ref<HTMLInputElement>;
}

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
  inputRef,
}) => {
  const theme = useTheme();

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
      inputRef={inputRef}
      FormHelperTextProps={
        /* aria-disabled on the helper-text <p> lets axe recognise it as part of a
           disabled control and correctly skip the colour-contrast check.
           WCAG 1.4.3 SC explicitly exempts inactive UI components from contrast
           requirements, but axe cannot infer this from the <input> alone.
           MDN: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-disabled
           Deque: https://dequeuniversity.com/rules/axe/4.11/color-contrast */
        disabled ? { 'aria-disabled': true } : undefined
      }
      sx={{
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
      }}
      inputProps={{
        min: type === 'number' ? 0 : undefined,
        step: type === 'number' ? 'any' : undefined,
      }}
      InputProps={{
        startAdornment: startAdornment ? (
          <InputAdornment position="start">{startAdornment}</InputAdornment>
        ) : undefined,
        endAdornment: endAdornment ? (
          <InputAdornment position="end">{endAdornment}</InputAdornment>
        ) : undefined,
      }}
    />
  );
};
