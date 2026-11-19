// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// The grey information banner of the Setup steps: an information icon, a bold title and supporting
// text.

import { Icon } from '@iconify/react';
import { Box, Stack, Typography } from '@mui/material';
import { ReactNode } from 'react';

export function InfoBanner({
  title,
  children,
}: {
  readonly title: string;
  readonly children?: ReactNode;
}) {
  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={{ px: 2, py: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}
    >
      <Box sx={{ display: 'flex', pt: 0.25, color: 'primary.main' }}>
        <Icon icon="mdi:information-outline" width={20} height={20} />
      </Box>
      <Box>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
        {children}
      </Box>
    </Stack>
  );
}
