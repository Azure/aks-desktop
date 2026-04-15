// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Meta, StoryFn } from '@storybook/react';
import React from 'react';
import { useDockerfileDiscovery } from '../hooks/useDockerfileDiscovery';
import { DockerfileConfirmation } from './DockerfileConfirmation';

const meta: Meta<typeof DockerfileConfirmation> = {
  title: 'GitHubPipeline/DockerfileConfirmation',
  component: DockerfileConfirmation,
};
export default meta;

/**
 * Zero Dockerfiles discovered — the component renders nothing. Included as a story
 * to verify this is the intended state (not a bug).
 */
export const NoDockerfiles: StoryFn = () => {
  const discovery = useDockerfileDiscovery([]);
  return <DockerfileConfirmation dockerfilePaths={[]} discovery={discovery} />;
};

/**
 * Exactly one Dockerfile — auto-selected, Select dropdown hidden, build context
 * derived from the path.
 */
export const SingleDockerfile: StoryFn = () => {
  const discovery = useDockerfileDiscovery(['Dockerfile']);
  return <DockerfileConfirmation dockerfilePaths={['Dockerfile']} discovery={discovery} />;
};

/** Multiple Dockerfiles — Select dropdown shown, user must pick one. */
export const MultipleDockerfiles: StoryFn = () => {
  const paths = ['Dockerfile', 'src/web/Dockerfile', 'src/api/Dockerfile.prod'];
  const discovery = useDockerfileDiscovery(paths);
  return <DockerfileConfirmation dockerfilePaths={paths} discovery={discovery} />;
};

/** Variant filenames like `dev.Dockerfile` are surfaced alongside standard ones. */
export const VariantFilenames: StoryFn = () => {
  const paths = ['Dockerfile', 'dev.Dockerfile', 'Dockerfile.prod'];
  const discovery = useDockerfileDiscovery(paths);
  return <DockerfileConfirmation dockerfilePaths={paths} discovery={discovery} />;
};
