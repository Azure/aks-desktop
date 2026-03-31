// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Loader } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Alert,
  Box,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import React from 'react';
import { useAccessTab } from './hooks/useAccessTab';

/** Component to display table of present Azure Role Assignments */
export default function AccessTab({
  project,
}: {
  project: { clusters: string[]; namespaces: string[] };
}) {
  const { loading, error, assignments, refresh } = useAccessTab(project);
  const { t } = useTranslation();

  if (loading && assignments.length === 0) {
    return <Loader title={t('Loading role assignments…')} />;
  }

  return (
    <Box sx={{ my: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="h6" component="h2">
          {t('Azure Role Assignments')}
        </Typography>
        <Tooltip title={t('Refresh')}>
          <IconButton
            size="small"
            onClick={refresh}
            disabled={loading}
            aria-label={t('Refresh')}
            aria-busy={loading || undefined}
          >
            <Icon icon="mdi:refresh" width={20} aria-hidden="true" />
          </IconButton>
        </Tooltip>
      </Box>
      {error ? (
        <Alert severity="error" role="alert" sx={{ mt: 1 }}>
          {error}
        </Alert>
      ) : assignments.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t('No role assignments found for {{ namespace }} on {{ cluster }}.', {
            namespace: project.namespaces[0],
            cluster: project.clusters[0],
          })}
        </Typography>
      ) : (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('Showing assignments for {{ namespace }} on {{ cluster }}', {
              namespace: project.namespaces[0],
              cluster: project.clusters[0],
            })}
          </Typography>
          <TableContainer sx={{ ml: -2 }}>
            <Table
              size="small"
              aria-label={t('Role assignments for {{ namespace }} on {{ cluster }}', {
                namespace: project.namespaces[0],
                cluster: project.clusters[0],
              })}
            >
              <TableHead>
                <TableRow>
                  <TableCell>{t('Principal')}</TableCell>
                  <TableCell>{t('Type')}</TableCell>
                  <TableCell>{t('Role')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {assignments.map(a => (
                  <TableRow
                    key={`${a.principalName || 'unknown'}-${a.principalType}-${
                      a.roleDefinitionName
                    }-${a.scope}`}
                  >
                    <TableCell>
                      {a.principalName || (
                        <Box component="span" aria-label={t('Unknown principal')}>
                          —
                        </Box>
                      )}
                    </TableCell>
                    <TableCell>{a.principalType}</TableCell>
                    <TableCell>{a.roleDefinitionName}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
    </Box>
  );
}
