// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// Setup file for React Testing Library tests
const jestDom = require('@testing-library/jest-dom');

// Add jest-dom matchers to expect
expect.extend(jestDom);
