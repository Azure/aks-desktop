// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import '@testing-library/jest-dom';

// Add global polyfills for React 18 compatibility
(global as any).IS_REACT_ACT_ENVIRONMENT = true;

// Mock window.matchMedia which is not implemented in JSDOM
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: () => ({
    matches: false,
    media: '',
    onchange: null,
    addListener: () => {}, // deprecated
    removeListener: () => {}, // deprecated
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// Mock ResizeObserver
(global as any).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock IntersectionObserver
(global as any).IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Suppress console warnings in tests unless explicitly needed
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

console.warn = (...args) => {
  if (
    args[0]?.includes?.('Warning: ReactDOM.render is deprecated') ||
    args[0]?.includes?.('Warning: Failed prop type') ||
    args[0]?.includes?.('`ReactDOMTestUtils.act` is deprecated')
  ) {
    return;
  }
  originalConsoleWarn(...args);
};

console.error = (...args) => {
  if (
    args[0]?.includes?.('`ReactDOMTestUtils.act` is deprecated') ||
    args[0]?.includes?.('React.act is not a function')
  ) {
    return;
  }
  originalConsoleError(...args);
};
