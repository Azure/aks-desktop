/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { configureStore } from '@reduxjs/toolkit';
import * as analytics from '../lib/analytics';
import eventCallbackReducer, { addEventCallback, eventAction } from './headlampEventSlice';
import { listenerMiddleware } from './headlampEventSlice';

function getStore() {
  return configureStore({
    reducer: {
      eventCallbackReducer,
    },
    middleware: getDefaultMiddleware =>
      getDefaultMiddleware({
        serializableCheck: false,
      }).prepend(listenerMiddleware.middleware),
  });
}

describe('eventsSlice', () => {
  let store = getStore();

  beforeEach(() => {
    store = getStore();
  });

  describe('addEventCallback', () => {
    it('should add a new event callback', () => {
      const eventCallback = () => {};
      store.dispatch(addEventCallback(eventCallback));

      const storedCb = store.getState().eventCallbackReducer.trackerFuncs[0];
      expect(storedCb).toEqual(eventCallback);
    });

    it('should run event callback', () => {
      const eventCallback = vi.fn(async () => {});
      store.dispatch(addEventCallback(eventCallback));

      store.dispatch(
        eventAction({
          type: 'test',
          data: {},
        })
      );

      expect(eventCallback).toHaveBeenCalled();
    });

    it('should run multiple event callbacks sequentially', () => {
      const callbackResponses: number[] = [];
      const eventCallback = vi.fn(async () => {
        callbackResponses.push(0);
      });
      store.dispatch(addEventCallback(eventCallback));

      const eventCallback1 = vi.fn(async () => {
        callbackResponses.push(1);
      });
      store.dispatch(addEventCallback(eventCallback1));

      store.dispatch(
        eventAction({
          type: 'test',
          data: {},
        })
      );

      expect(callbackResponses).toEqual([0, 1]);
    });
  });

  describe('analytics tracking', () => {
    it('should call trackEvent with event type when appInsights is defined', () => {
      const mockTrackEvent = vi.fn();
      window.appInsights = { trackEvent: mockTrackEvent } as unknown as typeof window.appInsights;
      const trackEventSpy = vi.spyOn(analytics, 'trackEvent');

      store.dispatch(
        eventAction({
          type: 'test-event-type',
          data: {},
        })
      );

      expect(trackEventSpy).toHaveBeenCalledWith('test-event-type');

      delete window.appInsights;
      trackEventSpy.mockRestore();
    });

    it('should be a no-op when appInsights is undefined', () => {
      const originalAppInsights = window.appInsights;
      delete window.appInsights;

      const trackEventSpy = vi.spyOn(analytics, 'trackEvent');

      store.dispatch(
        eventAction({
          type: 'test-event-type',
          data: {},
        })
      );

      expect(trackEventSpy).toHaveBeenCalledWith('test-event-type');
      expect(window.appInsights).toBeUndefined();

      window.appInsights = originalAppInsights;
      trackEventSpy.mockRestore();
    });
  });
});
