// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  WorkloadLogs: ({ item }: { item: { jsonData: { metadata: { name: string } } } }) => (
    <div data-testid="workload-logs">{item.jsonData.metadata.name}</div>
  ),
}));

import LogsTab from './LogsTab';

describe('LogsTab', () => {
  it('renders the selected deployment with the host workload logs component', async () => {
    const deployment = {
      kind: 'Deployment',
      jsonData: {
        metadata: {
          name: 'example-app',
          uid: 'deployment-example-app',
        },
      },
    } as any;

    render(<LogsTab projectResources={[deployment]} />);

    expect(await screen.findByTestId('workload-logs')).toHaveTextContent('example-app');
  });
});
