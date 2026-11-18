# Utils Testing Guide

This directory contains TypeScript tests for the utility functions in the AKS Headlamp plugin. Tests are designed to run in CI/CD environments without requiring Azure CLI authentication.

## Test Structure

```
src/utils/test/
├── azureLiveAuthBridge.test.ts # Restricted live-test authentication bridge
└── README.md
```

## Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npx vitest run src/utils/test/getClusterCapabilities.test.ts

# Run tests in watch mode
npx vitest src/utils/test/
```

## Configuration

- **Test runner:** Vitest (via `headlamp-plugin test`)
- **Config:** Provided by `@kinvolk/headlamp-plugin`
- **Mocking:** Use `vi` from Vitest for mocks and spies

## Test Coverage

Azure CLI commands are mocked using `vi.mock()` to avoid external dependencies.

## Adding New Tests

1. Create a new `.test.ts` file in this directory
2. Import Vitest utilities: `import { describe, test, expect, vi } from 'vitest'`
3. Mock external dependencies using `vi.mock()`
4. Run `npm test` to verify

### Example Test Structure

```typescript
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockRunCommand = vi.hoisted(() => vi.fn());

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  runCommand: mockRunCommand,
}));

describe('Your Utility', () => {
  beforeEach(() => {
    mockRunCommand.mockClear();
  });

  test('should do something', async () => {
    mockRunCommand.mockReturnValue(/* mock response */);
    // test your function
    expect(result).toBe(expected);
  });
});
```

## Troubleshooting

**Tests hanging or timing out:**

- Ensure async operations are properly awaited
- Check that mock implementations call callbacks synchronously in tests

**Mock not working:**

- Use `vi.hoisted()` for mocks that need to be available before imports
- Ensure `vi.mock()` is called at the top level, not inside `describe`/`test`

## CI/CD Integration

Tests run without Azure CLI authentication - all external calls are mocked. Safe for automated pipelines.
