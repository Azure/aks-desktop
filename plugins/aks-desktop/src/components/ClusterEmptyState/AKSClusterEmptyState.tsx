// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Box } from '@mui/material';
import type { ReactNode } from 'react';
import React from 'react';
import AzureLogo from '../Logo/Logo';

interface AKSClusterEmptyStateProps {
  defaultContent: ReactNode;
}

export default function AKSClusterEmptyState({ defaultContent }: AKSClusterEmptyStateProps) {
  return (
    <Box sx={{ display: 'grid', justifyItems: 'center', gap: 2 }}>
      <AzureLogo />
      {defaultContent}
    </Box>
  );
}
