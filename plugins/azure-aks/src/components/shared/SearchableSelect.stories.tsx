// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Meta, StoryFn } from '@storybook/react';
import React from 'react';
import type { SearchableSelectProps } from './SearchableSelect';
import { SearchableSelect } from './SearchableSelect';

const SUBSCRIPTION_OPTIONS = [
  { value: 'sub-123', label: 'Production Subscription', subtitle: 'sub-123' },
  { value: 'sub-456', label: 'Development Subscription', subtitle: 'sub-456' },
  { value: 'sub-789', label: 'Staging Subscription', subtitle: 'sub-789' },
];

const BASE_PROPS: SearchableSelectProps = {
  label: 'Subscription',
  value: '',
  onChange: () => {},
  options: SUBSCRIPTION_OPTIONS,
};

const meta: Meta<typeof SearchableSelect> = {
  title: 'CreateAKSProject/SearchableSelect',
  component: SearchableSelect,
};
export default meta;

/** Default empty state. */
export const Default: StoryFn<SearchableSelectProps> = () => <SearchableSelect {...BASE_PROPS} />;

/** With a value selected. */
export const WithSelection: StoryFn<SearchableSelectProps> = () => (
  <SearchableSelect {...BASE_PROPS} value="sub-123" />
);

/** Loading state. */
export const Loading: StoryFn<SearchableSelectProps> = () => (
  <SearchableSelect {...BASE_PROPS} loading />
);

/** Error state. */
export const WithError: StoryFn<SearchableSelectProps> = () => (
  <SearchableSelect {...BASE_PROPS} error helperText="Please select a subscription" />
);

/** Disabled state. */
export const Disabled: StoryFn<SearchableSelectProps> = () => (
  <SearchableSelect {...BASE_PROPS} value="sub-123" disabled />
);
