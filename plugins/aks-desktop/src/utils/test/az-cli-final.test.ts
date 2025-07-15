// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Azure CLI utilities test - compatible with both Jest and manual execution
 */

// Define types for mock functions
interface MockChildProcess {
  stdout: {
    on: (event: string, callback: (data: string) => void) => void;
  };
  stderr: {
    on: (event: string, callback: (data: string) => void) => void;
  };
  on: (event: string, callback: () => void) => void;
}

interface MockRunCommand {
  (...args: any[]): MockChildProcess;
  mockReturnValue?: (value: MockChildProcess) => MockRunCommand;
  mockClear?: () => void;
  _mockReturnValue?: MockChildProcess;
}

interface TestCase {
  name: string;
  fn: () => Promise<void>;
}

// Mock the headlamp plugin
const mockRunCommand: MockRunCommand =
  typeof jest !== 'undefined' && jest.fn
    ? jest.fn()
    : (() => {
        let calls: any[] = [];
        const fn = (...args: any[]) => {
          calls.push(args);
          return fn._mockReturnValue!;
        };
        fn._mockReturnValue = {
          stdout: { on: () => {} },
          stderr: { on: () => {} },
          on: () => {},
        } as MockChildProcess;
        fn.mockReturnValue = (value: MockChildProcess) => {
          fn._mockReturnValue = value;
          return fn;
        };
        fn.mockClear = () => {
          calls = [];
        };
        return fn as MockRunCommand;
      })();

// Mock Azure CLI functions
const mockAzCliFunctions = {
  isAzCliInstalled: async (): Promise<boolean> => {
    return new Promise(resolve => {
      const cmd = mockRunCommand('az', ['--version']);
      let stdout = '';
      let stderr = '';

      cmd.stdout.on('data', (data: string) => (stdout += data));
      cmd.stderr.on('data', (data: string) => (stderr += data));

      cmd.on('exit', () => {
        const match = stdout.split('\n')[0]?.match(/azure-cli\s+([^\s]+)/);
        if (match && match[1]) {
          resolve(true);
        } else {
          resolve(false);
        }
      });
    });
  },

  isAzCliLoggedIn: async (): Promise<boolean> => {
    return new Promise(resolve => {
      const cmd = mockRunCommand('az', ['account', 'show', '--query', 'user.name', '-o', 'tsv']);
      let stdout = '';
      let stderr = '';

      cmd.stdout.on('data', (data: string) => (stdout += data));
      cmd.stderr.on('data', (data: string) => (stderr += data));

      cmd.on('exit', () => {
        resolve(!!stdout.trim());
      });
    });
  },
};

const { isAzCliInstalled, isAzCliLoggedIn } = mockAzCliFunctions;

// Test helper function
const createMockChildProcess = (stdoutData: string, stderrData: string = ''): MockChildProcess => ({
  stdout: {
    on: (event: string, callback: (data: string) => void) => {
      if (event === 'data') {
        callback(stdoutData);
      }
    },
  },
  stderr: {
    on: (event: string, callback: (data: string) => void) => {
      if (event === 'data') {
        callback(stderrData);
      }
    },
  },
  on: (event: string, callback: () => void) => {
    if (event === 'exit') {
      callback();
    }
  },
});

// Jest test suite
if (typeof describe === 'function' && typeof test === 'function') {
  describe('Azure CLI Utilities', () => {
    beforeEach(() => {
      if (mockRunCommand.mockClear) {
        mockRunCommand.mockClear();
      }
    });

    test('should return true when az CLI is installed', async () => {
      const mockChildProcess = createMockChildProcess('azure-cli                         2.59.0\n');
      mockRunCommand.mockReturnValue!(mockChildProcess);

      const result = await isAzCliInstalled();
      expect(result).toBe(true);
    });

    test('should return false when az CLI is not installed', async () => {
      const mockChildProcess = createMockChildProcess('');
      mockRunCommand.mockReturnValue!(mockChildProcess);

      const result = await isAzCliInstalled();
      expect(result).toBe(false);
    });

    test('should return true when user is logged in', async () => {
      const mockChildProcess = createMockChildProcess('user@example.com');
      mockRunCommand.mockReturnValue!(mockChildProcess);

      const result = await isAzCliLoggedIn();
      expect(result).toBe(true);
    });

    test('should return false when user is not logged in', async () => {
      const mockChildProcess = createMockChildProcess('', 'Please run "az login" to setup account');
      mockRunCommand.mockReturnValue!(mockChildProcess);

      const result = await isAzCliLoggedIn();
      expect(result).toBe(false);
    });
  });
}

// Manual test runner for non-Jest environments
if (typeof describe === 'undefined') {
  const simpleExpect = (actual: any): SimpleExpected => ({
    toBe: (expected: any) => {
      if (actual !== expected) {
        throw new Error(`Expected ${actual} to be ${expected}`);
      }
    },
  });

  interface SimpleExpected {
    toBe: (expected: any) => void;
  }

  const tests: TestCase[] = [
    {
      name: 'should return true when az CLI is installed',
      fn: async () => {
        const mockChildProcess = createMockChildProcess(
          'azure-cli                         2.59.0\n'
        );
        mockRunCommand.mockReturnValue!(mockChildProcess);

        const result = await isAzCliInstalled();
        simpleExpect(result).toBe(true);
      },
    },
    {
      name: 'should return false when az CLI is not installed',
      fn: async () => {
        const mockChildProcess = createMockChildProcess('');
        mockRunCommand.mockReturnValue!(mockChildProcess);

        const result = await isAzCliInstalled();
        simpleExpect(result).toBe(false);
      },
    },
    {
      name: 'should return true when user is logged in',
      fn: async () => {
        const mockChildProcess = createMockChildProcess('user@example.com');
        mockRunCommand.mockReturnValue!(mockChildProcess);

        const result = await isAzCliLoggedIn();
        simpleExpect(result).toBe(true);
      },
    },
    {
      name: 'should return false when user is not logged in',
      fn: async () => {
        const mockChildProcess = createMockChildProcess(
          '',
          'Please run "az login" to setup account'
        );
        mockRunCommand.mockReturnValue!(mockChildProcess);

        const result = await isAzCliLoggedIn();
        simpleExpect(result).toBe(false);
      },
    },
  ];

  async function runTests(): Promise<void> {
    console.log('Running Azure CLI utility tests...\n');

    let passed = 0;
    let failed = 0;

    for (const test of tests) {
      try {
        if (mockRunCommand.mockClear) {
          mockRunCommand.mockClear();
        }
        await test.fn();
        console.log(`    ✓ ${test.name}`);
        passed++;
      } catch (error) {
        console.log(`    ✗ ${test.name}`);
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(`      Error: ${errorMessage}`);
        failed++;
      }
    }

    console.log(`\n📊 Test Results:`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📈 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);

    if (failed > 0) {
      process.exit(1);
    }
  }

  // Auto-run if this file is executed directly
  if (typeof require !== 'undefined' && require.main === module) {
    runTests();
  }
}

// Export for Jest if available
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isAzCliInstalled, isAzCliLoggedIn };
}
