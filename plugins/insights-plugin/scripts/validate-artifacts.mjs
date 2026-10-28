#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { validateDist } from './artifacts.mjs';

const results = validateDist();
for (const [description, passed] of results) {
  console.log(`${passed ? 'PASS' : 'FAIL'}: ${description}`);
}
const failures = results.filter(([, passed]) => !passed).length;
if (failures > 0) {
  console.log(`\n${failures} validation(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('\nAll validations passed.');
}
