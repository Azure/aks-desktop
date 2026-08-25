// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import '@testing-library/jest-dom/vitest';
import MenuItem from '@mui/material/MenuItem';
import MenuList from '@mui/material/MenuList';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openExternalUrl: vi.fn(),
  trackFeature: vi.fn(),
}));

vi.mock('../../utils/shared/openExternalUrl', () => ({
  openExternalUrl: mocks.openExternalUrl,
}));

vi.mock('../../telemetry', () => ({
  trackFeature: mocks.trackFeature,
}));

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// `@kinvolk/headlamp-plugin/lib/CommonComponents` is deliberately NOT mocked
// here, unlike most component tests in this repo. The markup ActionButton
// produces is the thing under test: the overflow-menu cases below assert how it
// nests inside Headlamp's own MenuItem wrapper, which a mock would erase.
import { CONTACT_US_URL } from '../../utils/constants/contactUs';
import ContactUsButton from './ContactUsButton';

beforeEach(() => {
  mocks.openExternalUrl.mockClear();
  mocks.trackFeature.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('ContactUsButton', () => {
  it('renders a button labelled "Contact us"', () => {
    render(<ContactUsButton />);
    expect(screen.getByRole('button', { name: /contact us/i })).toBeInTheDocument();
  });

  it('opens the contact URL when clicked', () => {
    render(<ContactUsButton />);
    fireEvent.click(screen.getByRole('button', { name: /contact us/i }));
    expect(mocks.openExternalUrl).toHaveBeenCalledWith(CONTACT_US_URL);
  });

  it('tracks the click', () => {
    render(<ContactUsButton />);
    fireEvent.click(screen.getByRole('button', { name: /contact us/i }));
    expect(mocks.trackFeature).toHaveBeenCalledWith({
      feature: 'aksd.feedback',
      status: 'opened',
    });
  });

  it('attempts navigation before recording the event', () => {
    render(<ContactUsButton />);
    fireEvent.click(screen.getByRole('button', { name: /contact us/i }));
    expect(mocks.openExternalUrl.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.trackFeature.mock.invocationCallOrder[0]
    );
  });

  /**
   * Below the `sm` breakpoint Headlamp's TopBar moves app-bar actions into an
   * overflow menu, rendering each one inside its own MenuItem
   * (AppBarActionsMenu in frontend/src/components/App/TopBar.tsx). Reproducing
   * that wrapper here is the only way this suite can catch a nested-menuitem
   * regression — rendering the component standalone cannot see it.
   */
  describe('wrapped the way TopBar wraps app-bar actions', () => {
    function renderInOverflowMenu() {
      return render(
        <MenuList>
          <MenuItem>
            <ContactUsButton />
          </MenuItem>
        </MenuList>
      );
    }

    it('contributes exactly one menuitem', () => {
      renderInOverflowMenu();
      // A second, nested menuitem would be invalid `<li>` in `<li>` and would
      // leave the action with no focusable control at all.
      expect(screen.getAllByRole('menuitem')).toHaveLength(1);
    });

    it('keeps a focusable control that activates the action', () => {
      renderInOverflowMenu();
      const button = screen.getByRole('button', { name: /contact us/i });

      // The wrapping MenuItem carries no click handler, so this button is the
      // only thing that can activate the action for a keyboard user.
      button.focus();
      expect(button).toHaveFocus();

      fireEvent.click(button);
      expect(mocks.openExternalUrl).toHaveBeenCalledWith(CONTACT_US_URL);
    });
  });
});
