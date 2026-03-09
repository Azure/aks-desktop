/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Portions (c) Microsoft Corp.

import {
  Checkbox,
  FormControl,
  InputLabel,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Select,
  type SelectChangeEvent,
} from '@mui/material';
import { Dispatch, SetStateAction, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { type ParsedLog } from './ParsedLog';

/** Calculate counts for each severity */
const useSeverityStats = (logs: ParsedLog[]) => {
  return useMemo(() => {
    const stats = new Map<string, number>();

    logs.forEach(({ severity }) => {
      const current = stats.get(severity) ?? 0;
      stats.set(severity, current + 1);
    });

    return stats;
  }, [logs]);
};

const ALL_SEVERITIES = ['info', 'error', 'warning', 'fatal', 'trace', 'debug'];

const ITEM_HEIGHT = 48;
const ITEM_PADDING_TOP = 8;
const SelectMenuProps = {
  PaperProps: {
    style: {
      maxHeight: ITEM_HEIGHT * 4.5 + ITEM_PADDING_TOP,
      width: 250,
    },
  },
};

/** Show a dropdown picker with different severity levels and their counts */
export function SeveritySelector({
  logs,
  severityFilter,
  setSeverityFilter,
}: {
  logs: ParsedLog[];
  severityFilter?: Set<string>;
  setSeverityFilter: Dispatch<SetStateAction<Set<string> | undefined>>;
}) {
  const { t } = useTranslation();
  const stats = useSeverityStats(logs);

  const selected = severityFilter
    ? ALL_SEVERITIES.filter(s => severityFilter.has(s))
    : ALL_SEVERITIES;

  const handleChange = (event: SelectChangeEvent<string[]>) => {
    const {
      target: { value },
    } = event;
    const newValue = typeof value === 'string' ? value.split(',') : value;

    if (newValue.length === ALL_SEVERITIES.length) {
      setSeverityFilter(undefined);
    } else {
      setSeverityFilter(new Set(newValue));
    }
  };

  const allSelected = severityFilter === undefined || severityFilter.size === ALL_SEVERITIES.length;

  return (
    <FormControl sx={{ minWidth: 180 }} size="small" variant="outlined">
      <InputLabel id="severity-select-label">{t('Log Level')}</InputLabel>
      <Select
        labelId="severity-select-label"
        id="severity-select"
        multiple
        value={selected}
        onChange={handleChange}
        input={<OutlinedInput label={t('Log Level')} />}
        renderValue={sel => (allSelected ? t('All levels') : sel.join(', '))}
        MenuProps={SelectMenuProps}
        sx={{ textTransform: 'capitalize' }}
      >
        {ALL_SEVERITIES.map(severity => (
          <MenuItem key={severity} value={severity} sx={{ textTransform: 'capitalize' }}>
            <Checkbox checked={selected.indexOf(severity) > -1} />
            <ListItemText primary={`${severity} (${stats.get(severity) ?? 0})`} />
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
