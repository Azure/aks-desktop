// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Meta, StoryFn } from '@storybook/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import DeployPure, { DeployPureProps } from './DeployPure';

export default {
  title: 'DeployWizard/DeployPure',
  component: DeployPure,
  decorators: [
    (Story: any) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
} as Meta;

const Template: StoryFn<DeployPureProps> = args => <DeployPure {...args} />;

const sampleYamlObjects = [
  { kind: 'Deployment', name: 'my-app', namespace: 'default' },
  { kind: 'Service', name: 'my-app-svc', namespace: 'default' },
];

export const Idle = Template.bind({});
Idle.args = {
  sourceType: 'yaml',
  namespace: 'default',
  containerPreviewYaml: '',
  deployResult: null,
  deployMessage: '',
  yamlObjects: sampleYamlObjects,
};

export const DeploySuccess = Template.bind({});
DeploySuccess.args = {
  ...Idle.args,
  deployResult: 'success',
  deployMessage: 'Applied 5 resources successfully.',
};

export const DeployError = Template.bind({});
DeployError.args = {
  ...Idle.args,
  deployResult: 'error',
  deployMessage:
    'Failed to apply resources: connection refused to api-server.production.svc.cluster.local:443 (error: ECONNREFUSED)',
};

export const YamlWithObjects = Template.bind({});
YamlWithObjects.args = {
  ...Idle.args,
  yamlObjects: [
    { kind: 'Deployment', name: 'api-server', namespace: 'production' },
    { kind: 'Service', name: 'api-server-svc' },
    { kind: 'Ingress', name: 'api-ingress', namespace: 'production' },
  ],
};

/** Edge case: no resources parsed from YAML. */
export const EmptyResourceList = Template.bind({});
EmptyResourceList.args = {
  ...Idle.args,
  yamlObjects: [],
};

/** Edge case: single resource — exercises singular count label. */
export const SingleResource = Template.bind({});
SingleResource.args = {
  ...Idle.args,
  yamlObjects: [{ kind: 'Deployment', name: 'web-frontend', namespace: 'production' }],
};

/** Multiple diverse resource kinds. */
export const ManyResourceTypes = Template.bind({});
ManyResourceTypes.args = {
  ...Idle.args,
  yamlObjects: [
    { kind: 'Deployment', name: 'web-frontend', namespace: 'production' },
    { kind: 'Service', name: 'web-frontend-svc', namespace: 'production' },
    { kind: 'ConfigMap', name: 'app-config', namespace: 'production' },
    { kind: 'HorizontalPodAutoscaler', name: 'web-frontend-hpa', namespace: 'production' },
    { kind: 'ServiceAccount', name: 'web-frontend-sa', namespace: 'production' },
  ],
};
