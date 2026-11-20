// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// The bordered card with a bold title and name-value rows, shared by Overview and the Configure
// step.

import { Box, Divider, Stack, Typography } from '@mui/material';
import { ReactNode } from 'react';
import { TextRow } from './clusterText';

export function Card({
  title,
  action,
  headingLevel = 'h2',
  headerFill = false,
  children,
}: {
  readonly title: string;
  readonly action?: ReactNode;
  readonly headingLevel?: 'h2' | 'h3';
  /** A grey title row, as on the Setup steps; Overview keeps a plain one. */
  readonly headerFill?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ px: 2, py: 1.5, bgcolor: headerFill ? 'action.hover' : undefined }}
      >
        <Typography component={headingLevel} variant="subtitle1" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
        {action}
      </Stack>
      <Divider />
      {children}
    </Box>
  );
}

/**
 * Name on the left and the value, bold, on the right, one row per entry. Rows are keyed by
 * position: Headlamp's plugin `t()` returns '' until the plugin's translations load, so names
 * are not unique keys on the first render.
 */
export function DetailRows({ rows }: { readonly rows: readonly TextRow[] }) {
  return (
    <Box component="dl" sx={{ m: 0 }}>
      {rows.map((row, index) => (
        <Stack
          key={index}
          direction="row"
          justifyContent="space-between"
          spacing={2}
          sx={{ px: 2, py: 1.25, borderTop: index === 0 ? 0 : 1, borderColor: 'divider' }}
        >
          <Typography component="dt" variant="body2" color="text.secondary">
            {row.name}
          </Typography>
          <Typography
            component="dd"
            variant="body2"
            sx={{ m: 0, fontWeight: 600, textAlign: 'right' }}
          >
            {row.value}
          </Typography>
        </Stack>
      ))}
    </Box>
  );
}
