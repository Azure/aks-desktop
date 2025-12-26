// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { AppTheme } from '@kinvolk/headlamp-plugin/lib/AppTheme';

export const azureTheme: AppTheme = {
  name: 'Azure Theme',
  base: 'light',
  primary: '#3F3682', // AKS Purple - primary brand color
  secondary: '#ecebe9', // Gray neutral color
  text: {
    primary: '#000000', // Black for maximum contrast and readability
    // @ts-ignore todo: fix palette type so text.secondary is recognized
    secondary: '#323130', // Dark gray for secondary text
  },
  background: {
    default: '#ffffff', // Off-white for main background
    // @ts-ignore todo: fix palette type so background.paper is recognized
    paper: '#ffffff', // White for cards/panels
    muted: '#f0f0f0', // Light gray for muted backgrounds
  },
  sidebar: {
    background: '#f0f0f0', // Match default background
    color: '#323130', // Dark gray for better readability than pure black
    selectedBackground: '#c2c2c2', // Light purple tint for selected items
    selectedColor: '#3F3682', // AKS purple for selected text
    actionBackground: '#3F3682', // AKS purple for action highlights
  },
  navbar: {
    background: '#001665',
    color: '#ffffff',
  },
  buttonTextTransform: 'none',
  radius: 4,
};
