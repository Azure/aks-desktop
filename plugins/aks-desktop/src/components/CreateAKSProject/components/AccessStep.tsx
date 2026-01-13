// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { TextField } from '@mui/material';
import { Box, Button, FormControl, Grid, IconButton, MenuItem, Typography } from '@mui/material';
import React from 'react';
import type { AccessStepProps, UserAssignment } from '../types';
import { AVAILABLE_ROLES, ROLE_DESCRIPTIONS } from '../types';
import { isValidEmail } from '../validators';
import { FormField } from './FormField';

/**
 * Access step component for user assignment management
 */
export const AccessStep: React.FC<AccessStepProps> = ({
  formData,
  onFormDataChange,
  loading = false,
}) => {
  const handleAssignmentChange = (index: number, field: keyof UserAssignment, value: string) => {
    const updatedAssignments = [...formData.userAssignments];
    updatedAssignments[index] = { ...updatedAssignments[index], [field]: value };
    onFormDataChange({ userAssignments: updatedAssignments });
  };

  const handleRemoveAssignment = (index: number) => {
    const updatedAssignments = formData.userAssignments.filter((_, i) => i !== index);
    onFormDataChange({ userAssignments: updatedAssignments });
  };

  const handleAddAssignment = () => {
    const newAssignment: UserAssignment = {
      email: '',
      role: 'Writer',
    };
    onFormDataChange({
      userAssignments: [...formData.userAssignments, newAssignment],
    });
  };

  const hasInvalidAssignments = formData.userAssignments.some(assignment => {
    const trimmedEmail = assignment.email.trim();
    return trimmedEmail === '' || !isValidEmail(trimmedEmail);
  });

  return (
    <Box>
      <Typography variant="h5" component="h2" gutterBottom>
        Access
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Assign permissions to users who need access to your namespace
      </Typography>
      <Grid container spacing={3}>
        {formData.userAssignments.map((assignment, idx) => (
          <React.Fragment key={idx}>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <FormField
                  label={`Assignee ${idx + 1} (email)`}
                  type="email"
                  value={assignment.email}
                  onChange={value => handleAssignmentChange(idx, 'email', value as string)}
                  placeholder="user@example.com"
                  disabled={loading}
                  error={assignment.email.trim() === '' || !isValidEmail(assignment.email.trim())}
                  helperText={
                    assignment.email.trim() === ''
                      ? 'Please enter a valid email address or remove this entry'
                      : !isValidEmail(assignment.email.trim())
                      ? 'Please enter a valid email address'
                      : ''
                  }
                />
              </FormControl>
            </Grid>
            <Grid item xs={10} md={5}>
              <TextField
                fullWidth
                select
                variant="outlined"
                label="Role"
                value={assignment.role}
                onChange={e => handleAssignmentChange(idx, 'role', e.target.value as string)}
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
                        sx={{ fontSize: '0.7rem', lineHeight: 1.3, mt: 0.5 }}
                      >
                        {ROLE_DESCRIPTIONS[role]}
                      </Typography>
                    </Box>
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={2} md={1} sx={{ display: 'flex', alignItems: 'flex-start' }}>
              <IconButton
                aria-label="Remove assignee"
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
            Add assignee
          </Button>
        </Grid>
      </Grid>
    </Box>
  );
};
