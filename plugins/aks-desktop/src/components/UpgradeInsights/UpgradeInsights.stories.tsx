// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { createTheme, ThemeProvider } from '@mui/material';
import type { Meta, StoryFn } from '@storybook/react';
import React from 'react';
import { StoryFrame, storyRecords } from './__fixtures__/storyFixtures';
import InventoryTable from './InventoryTable';

export default {
  title: 'UpgradeInsights/ReadinessInventory',
  component: InventoryTable,
} as Meta<typeof InventoryTable>;

function StoryInventory({ dark = false }: { dark?: boolean }) {
  const records = storyRecords();
  return (
    <ThemeProvider theme={createTheme({ palette: { mode: dark ? 'dark' : 'light' } })}>
      <StoryFrame>
        <InventoryTable records={records} disabled={false} onSelect={() => {}} />
      </StoryFrame>
    </ThemeProvider>
  );
}

export const Light: StoryFn = () => <StoryInventory />;
export const Dark: StoryFn = () => <StoryInventory dark />;
