// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Autocomplete, Chip, ChipProps } from '@mui/material';
import { Box, CircularProgress, TextField, Typography } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import React, { ReactNode, useMemo, useState } from 'react';

/** Optional chip/badge rendered next to an option's label (e.g. an "AKS Hybrid & Edge" tag). */
export interface SearchableSelectOptionChip {
  label: string;
  /** Iconify icon id shown inside the chip (e.g. `'mdi:server'`). */
  icon?: string;
  /** MUI chip color; defaults to `'info'`. */
  color?: ChipProps['color'];
}

export interface SearchableSelectOption {
  value: string;
  label: string;
  subtitle?: string;
  disabled?: boolean;
  /** Small chips rendered next to the option label, in order. */
  chips?: SearchableSelectOptionChip[];
}

export interface SearchableSelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  loading?: boolean;
  error?: boolean;
  disabled?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  noResultsText?: string;
  showSearch?: boolean;
  className?: string;
  helperText?: ReactNode;
}

/**
 * Searchable select component with enhanced display options
 */
export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  label,
  value,
  onChange,
  options,
  loading = false,
  error = false,
  disabled = false,
  placeholder,
  helperText,
  noResultsText,
}) => {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? `${t('Select an option')}...`;
  const resolvedNoResults = noResultsText ?? t('No options');
  const [inputValue, setInputValue] = useState('');
  const [open, setOpen] = useState(false);

  // Sort options alphabetically by label
  const sortedOptions = useMemo(() => {
    return [...options].sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
    );
  }, [options]);

  // Replicate MUI's default filter to detect zero matches for screen reader announcement
  const noFilteredResults = useMemo(() => {
    if (inputValue === '' && sortedOptions.length === 0) return true;
    const lower = inputValue.toLowerCase();
    return !sortedOptions.some(opt => opt.label.toLowerCase().includes(lower));
  }, [sortedOptions, inputValue]);

  return (
    <>
      <Box role="status" aria-live="polite" aria-atomic="true" sx={visuallyHidden}>
        {open && noFilteredResults ? resolvedNoResults : ''}
      </Box>
      <Autocomplete
        open={open}
        onOpen={() => setOpen(true)}
        onClose={() => setOpen(false)}
        inputValue={inputValue}
        onInputChange={(_, newValue) => setInputValue(newValue)}
        options={sortedOptions}
        disabled={disabled}
        getOptionKey={it => it.value}
        getOptionDisabled={option => !!option.disabled}
        value={sortedOptions.find(it => it.value === value) ?? null}
        noOptionsText={resolvedNoResults}
        renderInput={params => (
          <TextField
            {...params}
            label={label}
            variant="outlined"
            helperText={helperText}
            placeholder={resolvedPlaceholder}
            error={error}
            InputProps={{
              ...params.InputProps,
              endAdornment: (
                <>
                  {/* The adornment spinner is decorative; MUI Autocomplete already manages
                    aria-busy on the listbox via the loading prop, so this spinner
                    would cause a duplicate announcement if not hidden.
                    MUI: https://mui.com/material-ui/react-autocomplete/#asynchronous-requests */}
                  {loading ? (
                    <CircularProgress color="inherit" size={20} aria-hidden="true" />
                  ) : null}
                  {params.InputProps.endAdornment}
                </>
              ),
            }}
          />
        )}
        loading={loading}
        onChange={(e, newValue) => onChange(newValue?.value ?? '')}
        renderOption={(props, option) => {
          const { key, ...optionProps } = props;
          return (
            <Box component="li" key={key} {...optionProps}>
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body1">{option.label}</Typography>
                  {option.chips?.map(chip => (
                    <Chip
                      key={chip.label}
                      label={chip.label}
                      size="small"
                      color={chip.color ?? 'info'}
                      variant="outlined"
                      icon={chip.icon ? <Icon icon={chip.icon} aria-hidden="true" /> : undefined}
                    />
                  ))}
                </Box>
                {option.subtitle && (
                  <Typography variant="caption" color="text.secondary">
                    {option.subtitle}
                  </Typography>
                )}
              </Box>
            </Box>
          );
        }}
      />
    </>
  );
};
