// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import {
  addEventCallback,
  headlampEventSlice,
  listenerMiddleware,
} from '@kinvolk/headlamp-plugin/lib/redux/headlampEventSlice';
import { configureStore } from '@reduxjs/toolkit';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { afterEach, expect, it, vi } from 'vitest';
import ContactUsButton from './ContactUsButton';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('publishes feedback to the host Headlamp event observer after navigation', async () => {
  const store = configureStore({
    reducer: { eventCallbackReducer: headlampEventSlice.reducer },
    middleware: getDefaultMiddleware =>
      getDefaultMiddleware({
        serializableCheck: {
          ignoredActions: [addEventCallback.type],
          ignoredPaths: ['eventCallbackReducer.trackerFuncs'],
        },
      }).prepend(listenerMiddleware.middleware),
  });
  const observer = vi.fn();
  store.dispatch(addEventCallback(observer));
  const open = vi.spyOn(window, 'open').mockImplementation(() => null);

  render(
    <Provider store={store}>
      <ContactUsButton />
    </Provider>
  );
  fireEvent.click(screen.getByRole('button', { name: /contact us/i }));

  await waitFor(() =>
    expect(observer).toHaveBeenCalledExactlyOnceWith({
      type: 'aksd.feedback',
      data: { status: 'opened' },
    })
  );
  expect(open.mock.invocationCallOrder[0]).toBeLessThan(observer.mock.invocationCallOrder[0]);
});
