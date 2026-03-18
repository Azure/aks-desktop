// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Meta, StoryFn } from '@storybook/react';
import React from 'react';
import type { BreadcrumbProps } from '../types';
import { Breadcrumb } from './Breadcrumb';

const STEPS = ['Basics', 'Networking Policies', 'Compute Quota', 'Access', 'Review'];

const BASE_PROPS: BreadcrumbProps = {
  steps: STEPS,
  activeStep: 0,
  onStepClick: () => {},
};

const meta: Meta<typeof Breadcrumb> = {
  title: 'CreateAKSProject/Breadcrumb',
  component: Breadcrumb,
};
export default meta;

/** First step active. */
export const FirstStep: StoryFn<BreadcrumbProps> = () => <Breadcrumb {...BASE_PROPS} />;

/** Middle step active (Compute Quota). */
export const MiddleStep: StoryFn<BreadcrumbProps> = () => (
  <Breadcrumb {...BASE_PROPS} activeStep={2} />
);

/** Last step active (Review). */
export const LastStep: StoryFn<BreadcrumbProps> = () => (
  <Breadcrumb {...BASE_PROPS} activeStep={4} />
);

/** Narrow container — verifies wrap behavior at constrained widths (e.g., 200% zoom). */
export const NarrowContainer: StoryFn<BreadcrumbProps> = () => (
  <div style={{ width: 500, border: '1px dashed #ccc' }}>
    <Breadcrumb {...BASE_PROPS} activeStep={4} />
  </div>
);
