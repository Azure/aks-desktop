// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { TextField } from '@mui/material';
import { Box, Button, FormControl, Grid, IconButton, MenuItem, Typography } from '@mui/material';
import React, { useEffect, useRef } from 'react';
import type { AccessStepProps, RoleType, UserAssignment } from '../types';
import { AVAILABLE_ROLES } from '../types';
import { isValidObjectId } from '../validators';
import { UserSearchField } from './UserSearchField';

function getRoleDescription(t: (key: string) => string, role: RoleType): string {
  switch (role) {
    case 'Reader':
      return t(
        'Read-only access to most objects in a namespace. Cannot view roles, role bindings, or Secrets.'
      );
    case 'Writer':
      return t(
        'Read/write access to most objects in a namespace. Cannot view or modify roles or role bindings. Can access Secrets and run Pods as any ServiceAccount in the namespace.'
      );
    case 'Admin':
      return t(
        'Read/write access to most resources in a namespace. Can create roles and role bindings within the namespace. Cannot write to resource quota or the namespace itself.'
      );
    default: {
      const _exhaustive: never = role;
      return String(_exhaustive);
    }
  }
}

/**
 * Access step component for user assignment management
 */
export const AccessStep: React.FC<AccessStepProps> = ({
  formData,
  onFormDataChange,
  loading = false,
}) => {
  const { t } = useTranslation();
  const lastAssigneeRef = useRef<HTMLInputElement>(null);
  const prevCountRef = useRef(formData.userAssignments.length);

  // Focus on the new assignment field when it is added
  useEffect(() => {
    if (formData.userAssignments.length > prevCountRef.current) {
      requestAnimationFrame(() => {
        lastAssigneeRef.current?.focus();
      });
    }
    prevCountRef.current = formData.userAssignments.length;
  }, [formData.userAssignments.length]);

  const handleAssignmentChange = (index: number, objectId: string, displayName?: string) => {
    const updatedAssignments = [...formData.userAssignments];
    const prevAssignment = updatedAssignments[index];

    // Keep explicit displayName; clear stale one when objectId changes; otherwise preserve
    const nextDisplayName =
      displayName ?? (prevAssignment?.objectId !== objectId ? '' : prevAssignment?.displayName);

    updatedAssignments[index] = {
      ...prevAssignment,
      objectId,
      displayName: nextDisplayName,
    };
    onFormDataChange({ userAssignments: updatedAssignments });
  };

  const handleRoleChange = (index: number, role: string) => {
    const updatedAssignments = [...formData.userAssignments];
    updatedAssignments[index] = { ...updatedAssignments[index], role };
    onFormDataChange({ userAssignments: updatedAssignments });
  };

  const handleRemoveAssignment = (index: number) => {
    const updatedAssignments = formData.userAssignments.filter((_, i) => i !== index);
    onFormDataChange({ userAssignments: updatedAssignments });
  };

  const handleAddAssignment = () => {
    const newAssignment: UserAssignment = {
      objectId: '',
      role: 'Writer',
    };
    onFormDataChange({
      userAssignments: [...formData.userAssignments, newAssignment],
    });
  };

  const hasInvalidAssignments = formData.userAssignments.some(assignment => {
    const trimmedId = assignment.objectId.trim();
    return trimmedId === '' || !isValidObjectId(trimmedId);
  });

  return (
    <Box>
      <Typography variant="h5" component="h2" gutterBottom>
        {t('Access')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {t('Assign permissions to users who need access to your namespace')}
      </Typography>
      <Grid container spacing={3}>
        {formData.userAssignments.map((assignment, idx) => (
          <React.Fragment key={idx}>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <UserSearchField
                  label={`${t('Assignee')} ${idx + 1}`}
                  value={assignment.objectId}
                  displayName={assignment.displayName}
                  onChange={(objectId, displayName) =>
                    handleAssignmentChange(idx, objectId, displayName)
                  }
                  disabled={loading}
                  error={
                    assignment.objectId.trim() === '' ||
                    !isValidObjectId(assignment.objectId.trim())
                  }
                  helperText={
                    assignment.objectId.trim() === ''
                      ? t('Search for a user or remove this entry')
                      : !isValidObjectId(assignment.objectId.trim())
                      ? t('Select a user from the search results or enter a valid object ID (UUID)')
                      : ''
                  }
                  inputRef={
                    idx === formData.userAssignments.length - 1 ? lastAssigneeRef : undefined
                  }
                />
              </FormControl>
            </Grid>
            <Grid item xs={10} md={5}>
              <TextField
                fullWidth
                select
                variant="outlined"
                label={t('Role')}
                value={assignment.role}
                onChange={e => handleRoleChange(idx, e.target.value)}
                disabled={loading}
                SelectProps={{
                  renderValue: (value: string) => value,
                }}
              >
                {AVAILABLE_ROLES.map(role => (
                  <MenuItem key={role} value={role}>
                    <Box>
                      <Typography variant="body1" component="div">
                        {role}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        component="div"
                        sx={{ fontSize: '0.7rem', lineHeight: 1.3, mt: 0.5, whiteSpace: 'normal' }}
                      >
                        {getRoleDescription(t, role)}
                      </Typography>
                    </Box>
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={2} md={1} sx={{ display: 'flex', alignItems: 'flex-start' }}>
              <IconButton
                aria-label={t('Remove assignee')}
                onClick={() => handleRemoveAssignment(idx)}
                size="large"
                disabled={loading}
              >
                <Icon icon="mdi:delete" />
              </IconButton>
            </Grid>
          </React.Fragment>
        ))}

        <Grid item xs={12}>
          <Button
            variant="text"
            startIcon={<Icon icon="mdi:plus-circle-outline" />}
            onClick={handleAddAssignment}
            disabled={loading || hasInvalidAssignments}
          >
            {t('Add assignee')}
          </Button>
        </Grid>
      </Grid>
    </Box>
  );
};
