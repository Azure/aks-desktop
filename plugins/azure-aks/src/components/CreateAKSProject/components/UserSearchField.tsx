// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Alert, Autocomplete, Box, CircularProgress, TextField, Typography } from '@mui/material';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { searchAzureADUsers } from '../../../utils/azure/az-ad';
import { isValidObjectId } from '../validators';

interface UserSearchFieldProps {
  value: string;
  displayName?: string;
  onChange: (objectId: string, displayName?: string) => void;
  disabled?: boolean;
  error?: boolean;
  helperText?: string;
  label: string;
  inputRef?: React.Ref<HTMLInputElement>;
}

interface UserOption {
  id: string;
  displayName: string;
  email: string;
  label: string;
}

/**
 * A user search autocomplete field that searches Azure AD by name/email
 * and resolves to an object ID. Falls back to manual UUID entry if
 * directory search is blocked by conditional access policies.
 */
export const UserSearchField: React.FC<UserSearchFieldProps> = ({
  value,
  displayName,
  onChange,
  disabled = false,
  error = false,
  helperText,
  label,
  inputRef,
}) => {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState(displayName || value || '');
  const [options, setOptions] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchAvailable, setSearchAvailable] = useState<boolean | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  // Sync inputValue when value/displayName changes externally
  useEffect(() => {
    if (displayName) {
      setInputValue(displayName);
    } else if (value && isValidObjectId(value)) {
      setInputValue(value);
    }
  }, [value, displayName]);

  const performSearch = useCallback(async (query: string) => {
    if (query.length < 2 || isValidObjectId(query)) {
      setOptions([]);
      return;
    }

    const thisRequestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const result = await searchAzureADUsers(query);
      // Ignore stale responses from earlier queries
      if (thisRequestId !== requestIdRef.current) {
        return;
      }
      if (!result.success) {
        // Only permanently disable search for known CA/permission errors
        const isPermissionError =
          result.error?.includes('AADSTS530084') ||
          result.error?.includes('AADSTS50079') ||
          result.error?.includes('Authorization_RequestDenied') ||
          result.error?.includes('Insufficient privileges');
        if (isPermissionError) {
          setSearchAvailable(false);
        }
        setOptions([]);
      } else {
        setSearchAvailable(true);
        setOptions(
          result.users.map(user => ({
            id: user.id,
            displayName: user.displayName,
            email: user.mail || user.userPrincipalName,
            label: user.displayName,
          }))
        );
      }
    } catch {
      if (thisRequestId !== requestIdRef.current) {
        return;
      }
      setOptions([]);
    } finally {
      if (thisRequestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  const handleInputChange = useCallback(
    (_event: React.SyntheticEvent, newInputValue: string, reason: string) => {
      // MUI fires onInputChange with reason="reset" after an option is selected.
      // Ignore it to prevent overwriting the objectId set by handleOptionSelect.
      if (reason === 'reset') {
        return;
      }

      setInputValue(newInputValue);

      // If user types a valid UUID directly, accept it immediately
      if (isValidObjectId(newInputValue.trim())) {
        onChange(newInputValue.trim());
        setOptions([]);
        return;
      }

      // If user clears the field
      if (!newInputValue.trim()) {
        onChange('');
        setOptions([]);
        return;
      }

      // If search is known to be unavailable, only propagate valid UUIDs
      // (non-UUID intermediate text stays local to avoid parent validation errors)
      if (searchAvailable === false) {
        return;
      }

      // Debounced search
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
      debounceTimer.current = setTimeout(() => {
        performSearch(newInputValue);
      }, 350);
    },
    [onChange, performSearch, searchAvailable]
  );

  const handleOptionSelect = useCallback(
    (_event: React.SyntheticEvent, option: UserOption | string | null) => {
      if (!option) {
        onChange('');
        return;
      }
      if (typeof option === 'string') {
        // freeSolo: user pressed enter on typed text
        if (isValidObjectId(option.trim())) {
          onChange(option.trim());
        }
        return;
      }
      onChange(option.id, option.displayName);
      setInputValue(option.displayName);
    },
    [onChange]
  );

  // Clean up debounce timer
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  const showFallbackMessage = searchAvailable === false;

  return (
    <Box>
      <Autocomplete<UserOption, false, false, true>
        freeSolo
        options={options}
        loading={loading}
        inputValue={inputValue}
        onInputChange={handleInputChange}
        onChange={handleOptionSelect}
        disabled={disabled}
        filterOptions={x => x} // disable built-in filtering since server-side
        getOptionLabel={(option: UserOption | string) =>
          typeof option === 'string' ? option : option.displayName
        }
        isOptionEqualToValue={(option, val) => {
          if (val === null || val === undefined) {
            return false;
          }
          if (typeof val === 'string') {
            return option.displayName === val || option.id === val;
          }
          return option.id === val.id;
        }}
        renderInput={params => (
          <TextField
            {...params}
            label={label}
            variant="outlined"
            error={error}
            helperText={helperText}
            placeholder={
              showFallbackMessage
                ? t('00000000-0000-0000-0000-000000000000')
                : t('Search by name or email...')
            }
            inputRef={inputRef}
            InputProps={{
              ...params.InputProps,
              endAdornment: (
                <>
                  {loading ? <CircularProgress color="inherit" size={20} /> : null}
                  {params.InputProps.endAdornment}
                </>
              ),
            }}
          />
        )}
        renderOption={(props, option) => {
          const { key, ...optionProps } = props;
          return (
            <Box component="li" key={key} {...optionProps}>
              <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                <Typography variant="body1">{option.displayName}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {option.email}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.disabled"
                  sx={{ fontFamily: 'monospace' }}
                >
                  {option.id}
                </Typography>
              </Box>
            </Box>
          );
        }}
        noOptionsText={
          inputValue.length >= 2 && !loading
            ? t('No users found')
            : t('Type at least 2 characters to search')
        }
      />
      {showFallbackMessage && (
        <Alert severity="info" sx={{ mt: 1, py: 0 }}>
          <Typography variant="caption">
            {t(
              'User search is not available. Enter the Azure AD object ID (UUID) directly. Find it in Azure Portal > Microsoft Entra ID > Users > select user > Object ID.'
            )}
          </Typography>
        </Alert>
      )}
      {value && displayName && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
          {t('Object ID')}: {value}
        </Typography>
      )}
    </Box>
  );
};
