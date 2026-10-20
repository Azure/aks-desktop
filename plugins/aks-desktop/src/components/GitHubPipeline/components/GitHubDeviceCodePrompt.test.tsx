// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openExternalUrl } from '../../../utils/shared/openExternalUrl';
import { GitHubDeviceCodePrompt } from './GitHubDeviceCodePrompt';

afterEach(cleanup);

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../../utils/shared/openExternalUrl', () => ({ openExternalUrl: vi.fn() }));
const authorization = {
  userCode: 'ABCD-EFGH',
  verificationUri: 'https://github.com/login/device',
  expiresAt: Date.now() + 900000,
  deviceCode: 'private-code-must-not-render',
};

describe('device-code prompt', () => {
  it('announces the public code and opens only the trusted verification page on a user action', () => {
    const cancel = vi.fn();
    render(<GitHubDeviceCodePrompt authorization={authorization} onCancel={cancel} />);
    expect(screen.getByRole('status')).toHaveTextContent('ABCD-EFGH');
    expect(document.body).not.toHaveTextContent('private-code-must-not-render');
    expect(openExternalUrl).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open GitHub' }));
    expect(openExternalUrl).toHaveBeenCalledWith('https://github.com/login/device');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('keeps Cancel stable and keyboard focus intact while requesting the initial code', () => {
    const cancel = vi.fn();
    const view = render(<GitHubDeviceCodePrompt authorization={null} onCancel={cancel} />);
    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    cancelButton.focus();
    expect(screen.getByRole('button', { name: 'Open GitHub' })).toBeDisabled();
    view.rerender(<GitHubDeviceCodePrompt authorization={authorization} onCancel={cancel} />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBe(cancelButton);
    expect(cancelButton).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Open GitHub' })).toBeEnabled();
  });
});
