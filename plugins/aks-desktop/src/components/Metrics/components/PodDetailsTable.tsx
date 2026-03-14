// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  Box,
  Card,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import React from 'react';
import type { PodInfo } from '../hooks/usePods';

/** Props for {@link PodDetailsTable}. */
export interface PodDetailsTableProps {
  /** The list of pods to display in the table.
   * @see {@link PodInfo}
   */
  pods: PodInfo[];
  /** The name of the selected deployment. */
  selectedDeployment: string;
}

/** Table listing pods for the selected deployment with status, CPU, memory, and restarts. */
export const PodDetailsTable: React.FC<PodDetailsTableProps> = ({ pods, selectedDeployment }) => {
  const { t } = useTranslation();

  return (
    <>
      <Typography variant="h6" sx={{ mb: 2, mt: 3 }}>
        {t('Pod Details')} - {selectedDeployment}
      </Typography>
      <Card>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>{t('Pod Name')}</TableCell>
              <TableCell>{t('Status')}</TableCell>
              <TableCell>{t('CPU')}</TableCell>
              <TableCell>{t('Memory')}</TableCell>
              <TableCell>{t('Restarts')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pods.length > 0 ? (
              pods.map(pod => (
                <TableRow key={pod.name}>
                  <TableCell>{pod.name}</TableCell>
                  <TableCell>
                    <Box
                      sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        color:
                          pod.status === 'Running'
                            ? 'success.main'
                            : pod.status === 'Pending'
                            ? 'warning.main'
                            : pod.status === 'Failed'
                            ? 'error.main'
                            : 'text.secondary',
                      }}
                    >
                      {pod.status === 'Running' && '● '}
                      {pod.status === 'Pending' && '◐ '}
                      {pod.status === 'Failed' && '● '}
                      {pod.status}
                    </Box>
                  </TableCell>
                  <TableCell>{pod.cpuUsage}</TableCell>
                  <TableCell>{pod.memoryUsage}</TableCell>
                  <TableCell>{pod.restarts}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} align="center">
                  {t('No pods found for deployment "{{name}}"', { name: selectedDeployment })}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
};
