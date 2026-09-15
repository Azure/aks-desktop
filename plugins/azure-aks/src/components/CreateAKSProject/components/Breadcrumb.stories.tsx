// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Meta, StoryFn } from '@storybook/react';
import React from 'react';
import { Breadcrumb } from '../../shared/Breadcrumb';
import type { BreadcrumbProps } from '../types';

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
