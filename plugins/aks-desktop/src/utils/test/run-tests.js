// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Test runner script that bypasses Jest globals issues
 * This can be run directly with Node.js or with Jest
 */

const { spawn } = require('child_process');
const path = require('path');

// Check command line arguments
const useJest = process.argv.includes('--jest');
const testFile = process.argv.find(arg => arg.includes('.test.'));

if (useJest && testFile) {
  // Use Jest for comprehensive testing
  console.log('🧪 Running Jest tests...\n');

  const jest = spawn('npx', ['jest', testFile, '--config', 'jest.config.utils.js', '--verbose'], {
    cwd: path.join(__dirname, '../../..'),
    stdio: 'inherit',
  });

  jest.on('close', code => {
    process.exit(code);
  });
} else if (useJest) {
  // Run all Jest tests
  console.log('🧪 Running all Jest tests...\n');

  const jest = spawn('npx', ['jest', '--config', 'jest.config.utils.js', '--verbose'], {
    cwd: path.join(__dirname, '../../..'),
    stdio: 'inherit',
  });

  jest.on('close', code => {
    process.exit(code);
  });
} else {
  // Run the JavaScript test file directly
  console.log('🧪 Running JavaScript test file directly...\n');

  const testFile = path.join(__dirname, 'az-cli-simple.test.js');

  try {
    // Use node to run the JavaScript test file
    const nodeProcess = spawn('node', [testFile], {
      cwd: path.join(__dirname, '../../..'),
      stdio: 'inherit',
    });

    nodeProcess.on('close', code => {
      if (code === 0) {
        console.log('\n✅ JavaScript tests completed successfully!');
      } else {
        console.log('\n❌ JavaScript tests failed');
      }
      process.exit(code);
    });
  } catch (error) {
    console.error('Error running JavaScript test:', error);
    process.exit(1);
  }
}
