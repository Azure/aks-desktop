// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Meta, StoryFn } from '@storybook/react';
import React, { useState } from 'react';
import type { DeployPathChoice } from './PathSelectionStep';
import { PathSelectionStep } from './PathSelectionStep';

const meta: Meta<typeof PathSelectionStep> = {
  title: 'GitHubPipeline/PathSelectionStep',
  component: PathSelectionStep,
};
export default meta;

/** No path chosen yet — initial render from the wizard. */
export const NoSelection: StoryFn = () => {
  const [selected, setSelected] = useState<DeployPathChoice | null>(null);
  return (
    <PathSelectionStep dockerfilePath="Dockerfile" selected={selected} onSelect={setSelected} />
  );
};

/** Recommended "fast" path selected. */
export const FastSelected: StoryFn = () => {
  const [selected, setSelected] = useState<DeployPathChoice | null>('fast');
  return (
    <PathSelectionStep dockerfilePath="Dockerfile" selected={selected} onSelect={setSelected} />
  );
};

/** Fast deploy with async AI suggestions selected. */
export const FastWithAiSelected: StoryFn = () => {
  const [selected, setSelected] = useState<DeployPathChoice | null>('fast-with-ai');
  return (
    <PathSelectionStep
      dockerfilePath="src/web/Dockerfile"
      selected={selected}
      onSelect={setSelected}
    />
  );
};

/** Full agent generation selected. */
export const AgentSelected: StoryFn = () => {
  const [selected, setSelected] = useState<DeployPathChoice | null>('agent');
  return (
    <PathSelectionStep
      dockerfilePath="apps/api/Dockerfile"
      selected={selected}
      onSelect={setSelected}
    />
  );
};
