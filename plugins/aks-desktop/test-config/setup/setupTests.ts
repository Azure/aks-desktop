// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// Setup file for React Testing Library tests
const jestDom = require('@testing-library/jest-dom');

// Extend Jest matchers with jest-dom

// Add jest-dom matchers to expect
if (typeof expect.extend === 'function') {
  expect.extend(jestDom);
}

export {};
