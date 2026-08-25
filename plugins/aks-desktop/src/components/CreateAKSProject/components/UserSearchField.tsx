// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Alert, Autocomplete, Box, CircularProgress, TextField, Typography } from '@mui/material';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { resolveAzureADUser, searchAzureADUsers } from '../../../utils/azure/az-ad';
import { isEntraObjectId, isUserPrincipalName } from '../../../utils/shared/entraIdentifiers';

/** What the field resolves a user to. See {@link UserAssignment} for why both. */
export interface UserSelection {
  /** Entra object ID used for Azure role assignments. */
  objectId: string;
  /** Display label for these identifiers, omitted when the selection is cleared. */
  displayName?: string;
  /** User principal name used by native Kubernetes RoleBindings. */
  upn?: string;
}

/** Props for {@link UserSearchField}. */
interface UserSearchFieldProps {
  /** Selected Entra object ID or unresolved typed identifier. */
  value: string;
  /** Display name shown for an already resolved selection. */
  displayName?: string;
  /** Called when an identifier resolves to a user selection. */
  onChange: (selection: UserSelection) => void;
  /** Whether the autocomplete input is disabled. */
  disabled?: boolean;
  /** Whether the input should show an error state. */
  error?: boolean;
  /** Supporting or validation text displayed below the input. */
  helperText?: string;
  /** Accessible and visible input label. */
  label: string;
  /** Optional ref forwarded to the underlying input element. */
  inputRef?: React.Ref<HTMLInputElement>;
}

interface UserOption {
  id: string;
  displayName: string;
  email: string;
  /**
   * Kept distinct from `email`: `mail` and the UPN can differ, and only the UPN
   * matches what the Arc apiserver sees as the username.
   */
  userPrincipalName: string;
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
    } else if (value && isEntraObjectId(value)) {
      setInputValue(value);
    }
  }, [value, displayName]);

  const performSearch = useCallback(async (query: string) => {
    // A complete identifier is taken at face value rather than searched for.
    if (query.length < 2 || isEntraObjectId(query) || isUserPrincipalName(query)) {
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
            userPrincipalName: user.userPrincipalName,
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

  /**
   * Accepts a hand-typed identifier and fills in whichever one is missing.
   *
   * The value is applied immediately so the field stays usable, then a directory
   * lookup upgrades it — the Azure and Kubernetes sides need different
   * identifiers, and typing gives only one of them. If the lookup is blocked the
   * partial selection stands, and validation decides whether it is enough.
   */
  const applyTypedValue = useCallback(
    (raw: string) => {
      const typed = raw.trim();
      const typedIsUpn = isUserPrincipalName(typed);
      onChange(typedIsUpn ? { objectId: '', upn: typed, displayName: typed } : { objectId: typed });

      const thisRequestId = ++requestIdRef.current;
      resolveAzureADUser(typed)
        .then(res => {
          if (thisRequestId !== requestIdRef.current || !res.success || !res.user) {
            return;
          }
          onChange({
            objectId: res.user.id,
            upn: res.user.userPrincipalName,
            displayName: res.user.displayName,
          });
        })
        .catch(() => {
          /* keep the partial selection; validation reports what is missing */
        });
    },
    [onChange]
  );

  const handleInputChange = useCallback(
    (_event: React.SyntheticEvent, newInputValue: string, reason: string) => {
      // MUI fires onInputChange with reason="reset" after an option is selected.
      // Ignore it to prevent overwriting the objectId set by handleOptionSelect.
      if (reason === 'reset') {
        return;
      }

      setInputValue(newInputValue);

      // If the user types a complete identifier directly, accept it immediately
      if (isEntraObjectId(newInputValue) || isUserPrincipalName(newInputValue)) {
        applyTypedValue(newInputValue);
        setOptions([]);
        return;
      }

      // If user clears the field
      if (!newInputValue.trim()) {
        // Abandon anything already in flight for the previous value: a search or
        // a `resolveAzureADUser` started a moment ago would otherwise land after
        // this and repopulate the assignee the user just cleared.
        requestIdRef.current += 1;
        if (debounceTimer.current) {
          clearTimeout(debounceTimer.current);
          debounceTimer.current = null;
        }
        onChange({ objectId: '' });
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
    [applyTypedValue, onChange, performSearch, searchAvailable]
  );

  const handleOptionSelect = useCallback(
    (_event: React.SyntheticEvent, option: UserOption | string | null) => {
      if (!option) {
        onChange({ objectId: '' });
        return;
      }
      if (typeof option === 'string') {
        // freeSolo: user pressed enter on typed text
        if (isEntraObjectId(option) || isUserPrincipalName(option)) {
          applyTypedValue(option);
        }
        return;
      }
      // Search results carry both identifiers, so no lookup is needed.
      onChange({
        objectId: option.id,
        displayName: option.displayName,
        upn: option.userPrincipalName,
      });
      setInputValue(option.displayName);
    },
    [applyTypedValue, onChange]
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
                ? t('someone@contoso.com or 00000000-0000-0000-0000-000000000000')
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
              'User search is not available. Enter the sign-in name (user principal name) or the Azure AD object ID directly — some clusters require the sign-in name. Find both in Azure Portal > Microsoft Entra ID > Users > select user.'
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
