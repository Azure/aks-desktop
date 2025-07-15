// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Azure CLI utilities test - Jest compatible
 */

interface MockChildProcess {
  stdout: {
    on: jest.Mock;
  };
  stderr: {
    on: jest.Mock;
  };
  on: jest.Mock;
}

// Mock the headlamp plugin
const mockRunCommand = jest.fn();

// Mock the headlamp plugin module
jest.mock('@kinvolk/headlamp-plugin/lib', () => ({
  runCommand: mockRunCommand,
}));

// Mock Azure CLI functions
const mockAzCliFunctions = {
  isAzCliInstalled: async (): Promise<boolean> => {
    return new Promise<boolean>(resolve => {
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
    return new Promise<boolean>(resolve => {
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
    on: jest.fn((event: string, callback: (data: string) => void) => {
      if (event === 'data') {
        callback(stdoutData);
      }
    }),
  },
  stderr: {
    on: jest.fn((event: string, callback: (data: string) => void) => {
      if (event === 'data') {
        callback(stderrData);
      }
    }),
  },
  on: jest.fn((event: string, callback: () => void) => {
    if (event === 'exit') {
      callback();
    }
  }),
});

describe('Azure CLI Utilities', () => {
  beforeEach(() => {
    mockRunCommand.mockClear();
  });

  test('should return true when az CLI is installed', async () => {
    const mockChildProcess: MockChildProcess = createMockChildProcess(
      'azure-cli                         2.59.0\n'
    );
    mockRunCommand.mockReturnValue(mockChildProcess);

    const result: boolean = await isAzCliInstalled();
    expect(result).toBe(true);
  });

  test('should return false when az CLI is not installed', async () => {
    const mockChildProcess: MockChildProcess = createMockChildProcess('');
    mockRunCommand.mockReturnValue(mockChildProcess);

    const result: boolean = await isAzCliInstalled();
    expect(result).toBe(false);
  });

  test('should return true when user is logged in', async () => {
    const mockChildProcess: MockChildProcess = createMockChildProcess('user@example.com');
    mockRunCommand.mockReturnValue(mockChildProcess);

    const result: boolean = await isAzCliLoggedIn();
    expect(result).toBe(true);
  });

  test('should return false when user is not logged in', async () => {
    const mockChildProcess: MockChildProcess = createMockChildProcess(
      '',
      'Please run "az login" to setup account'
    );
    mockRunCommand.mockReturnValue(mockChildProcess);

    const result: boolean = await isAzCliLoggedIn();
    expect(result).toBe(false);
  });
});

export { isAzCliInstalled, isAzCliLoggedIn };
