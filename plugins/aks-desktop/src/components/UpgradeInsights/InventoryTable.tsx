// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  Button,
  Chip,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import React, { useMemo, useState } from 'react';
import { type ClusterRecord, issueLabels } from '../../types/upgradeInsights';
import {
  csvCell,
  formatTime,
  issuesFor,
  latestCombined,
  readinessOrder,
  recordReadiness,
} from './domain';
import { useSnapshotClock } from './useSnapshotClock';

export default function InventoryTable({
  records,
  disabled,
  onSelect,
}: {
  records: ClusterRecord[];
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  useSnapshotClock();
  const [filter, setFilter] = useState('');
  const [category, setCategory] = useState('');
  const [sortReadiness, setSortReadiness] = useState(false);
  const counts = Object.keys(readinessOrder).map(status => ({
    status,
    count: records.filter(record => recordReadiness(record) === status).length,
  }));
  const categories = useMemo(
    () =>
      [
        ...new Set(
          records.flatMap(r =>
            issuesFor(latestCombined(r)).map(i => i.issue.issueType ?? 'Unknown issue')
          )
        ),
      ].sort(),
    [records]
  );
  const visible = records.filter(
    record =>
      (!filter || recordReadiness(record) === filter) &&
      (!category ||
        issuesFor(latestCombined(record)).some(
          i => (i.issue.issueType ?? 'Unknown issue') === category
        ))
  );
  if (sortReadiness) {
    visible.sort((a, b) => readinessOrder[recordReadiness(a)] - readinessOrder[recordReadiness(b)]);
  }

  function exportPage() {
    const rows = [
      [
        t('ARM resource'),
        t('Cluster'),
        t('Region'),
        t('Readiness'),
        t('Target'),
        t('Evaluated at'),
        t('Error'),
      ],
      ...visible.map(record => {
        const insight = latestCombined(record);
        return [
          record.cluster.id,
          record.cluster.name,
          record.cluster.location,
          t(recordReadiness(record)),
          insight?.properties.targetKubernetesVersion ?? '',
          insight?.properties.lastEvaluatedAt ?? '',
          record.error ?? '',
        ];
      }),
    ];
    const url = URL.createObjectURL(
      new Blob([rows.map(row => row.map(csvCell).join(',')).join('\r\n')], {
        type: 'text/csv;charset=utf-8',
      })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'aks-upgrade-readiness-page.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Stack spacing={2}>
      <Stack
        direction="row"
        spacing={1}
        flexWrap="wrap"
        aria-label={t('Current page readiness counts')}
      >
        {counts.map(({ status, count }) => (
          <Chip
            key={status}
            label={t('{{status}} on page: {{count}}', { status: t(status), count })}
          />
        ))}
      </Stack>
      <Stack direction="row" spacing={2} flexWrap="wrap">
        <TextField
          select
          label={t('Readiness on current page')}
          value={filter}
          disabled={disabled}
          onChange={event => setFilter(event.target.value)}
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="">{t('All readiness states')}</MenuItem>
          {counts.map(({ status }) => (
            <MenuItem key={status} value={status}>
              {t(status)}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label={t('Risk on current page')}
          value={category}
          disabled={disabled}
          onChange={event => setCategory(event.target.value)}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="">{t('All issue categories')}</MenuItem>
          {categories.map(value => (
            <MenuItem key={value} value={value}>
              {t(issueLabels[value] ?? value)}
            </MenuItem>
          ))}
        </TextField>
        <Button disabled={disabled} onClick={() => setSortReadiness(value => !value)}>
          {sortReadiness
            ? t('Use inventory order on current page')
            : t('Sort current page by readiness')}
        </Button>
        <Button disabled={disabled || !visible.length} onClick={exportPage}>
          {t('Export filtered page')}
        </Button>
      </Stack>
      <TableContainer>
        <Table aria-label={t('Cluster readiness on current page')}>
          <TableHead>
            <TableRow>
              {[
                t('Cluster'),
                t('Region / fleet'),
                t('Readiness'),
                t('Stored target'),
                t('Last evaluated'),
              ].map(label => (
                <TableCell key={label}>{label}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {visible.map(record => {
              const { cluster } = record;
              const insight = latestCombined(record);
              return (
                <TableRow key={cluster.id}>
                  <TableCell>
                    <Button disabled={disabled} onClick={() => onSelect(cluster.id)}>
                      {cluster.name}
                    </Button>
                    <Typography variant="caption" display="block" sx={{ overflowWrap: 'anywhere' }}>
                      {cluster.id}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {cluster.location}
                    <Typography variant="caption" display="block">
                      {cluster.fleets?.length
                        ? cluster.fleets.map(fleet => fleet.name).join(', ')
                        : cluster.fleetMembershipKnown
                        ? t('No fleet')
                        : t('Fleet membership unknown')}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {t(recordReadiness(record))}
                    {record.error && <Typography color="error">{record.error}</Typography>}
                  </TableCell>
                  <TableCell>
                    {insight?.properties.targetKubernetesVersion ?? t('Not evaluated')}
                  </TableCell>
                  <TableCell>
                    {formatTime(insight?.properties.lastEvaluatedAt) ?? t('Not available')}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      {!visible.length && (
        <Typography>{t('No clusters match the current page filters.')}</Typography>
      )}
    </Stack>
  );
}
