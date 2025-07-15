# Utils Testing Guide

This directory contains TypeScript tests for the utility functions in the AKS Headlamp plugin, specifically designed to run in CI/CD environments without requiring Azure CLI authentication.

## Test Structure

```
src/utils/test/
├── __mocks__/
│   └── headlamp-plugin.js          # Mock for @kinvolk/headlamp-plugin/lib
├── az-cli-simple.test.ts           # Main Azure CLI tests (TypeScript with Jest)
├── az-cli-final.test.ts            # Additional Azure CLI tests (TypeScript with Jest)
├── graph-api.test.ts               # Azure Resource Graph API tests (TypeScript with Jest)
├── github-api.test.ts              # GitHub API tests (TypeScript with Jest)
├── github-octokit.test.ts          # GitHub Octokit integration tests (TypeScript with Jest)
├── kubectl.test.ts                 # Kubernetes kubectl tests (TypeScript with Jest)
├── deployment.test.ts              # Application deployment tests (TypeScript with Jest)
├── managed-namespaces.test.ts      # Managed namespaces tests (TypeScript with Jest)
├── simple-jest.test.ts             # Simple Jest verification tests (TypeScript)
├── test-registry-validation.test.ts # Container registry validation tests (TypeScript)
├── graph-api-demo.ts               # Standalone demo of Graph API functionality
├── github-api-demo.ts              # Standalone demo of GitHub API functionality
├── run-tests.js                    # Flexible test runner (JavaScript utility)
├── setup.ts                        # Jest setup configuration (TypeScript)
└── README.md                       # This file
```

## Running Tests

### 🎯 TypeScript Test Execution (Recommended)

All tests are now written in TypeScript with comprehensive type safety:

```bash
# Run all TypeScript tests with Jest + ts-jest
npm run test:utils                  # Run all utility tests (59 tests across 10 suites)
npm run test:utils:watch            # Run tests in watch mode for development

# Run individual TypeScript test files
npx jest src/utils/test/graph-api.test.ts
npx jest src/utils/test/github-api.test.ts
npx jest src/utils/test/kubectl.test.ts

# Run with coverage reporting
npm run test:utils -- --coverage

# Run the Graph API demo (standalone, no Jest)
npx ts-node src/utils/test/graph-api-demo.ts

# Run the GitHub API demo (standalone, no Jest)
npx ts-node src/utils/test/github-api-demo.ts
```

### ✅ TypeScript-First Testing Benefits:

- ✅ **Full Type Safety** - Comprehensive TypeScript interfaces and error handling
- ✅ **Jest + ts-jest Integration** - Modern testing framework with TypeScript support
- ✅ **CI/CD Optimized** - Mock-based testing without Azure authentication requirements
- ✅ **Standalone Demos** - TypeScript demo files for debugging and understanding APIs
- ✅ **IntelliSense Support** - Enhanced developer experience with auto-completion
- ✅ **59 Tests Coverage** - Comprehensive test coverage across 10 test suites

### Option 2: Manual Test Runner (Legacy)

```bash
# Run with custom test runner
npm run test:utils:simple           # Run with custom test runner
npm run test:utils:jest             # Run with Jest via test runner
```

This approach:

- ✅ Flexible execution modes
- ✅ Works with both Jest and manual execution
- ✅ Good for debugging and development
- ✅ Alternative execution method

### Debugging Tests

If Jest tests hang or fail:

1. Check Jest timeout configuration (currently 30 seconds)
2. Verify mock implementations are correct
3. Ensure async operations are properly awaited
4. Use the demo script to validate logic outside Jest environment

# Run Jest in watch mode

npm run test:utils:watch

# Run Jest with coverage

npm run test:utils

````

## Test Configuration

### 🔧 TypeScript Jest Configuration (`jest.config.utils.js`)

Optimized for TypeScript testing with ts-jest preset:

```javascript
module.exports = {
  preset: 'ts-jest',                // TypeScript support via ts-jest
  testEnvironment: 'jsdom',
  rootDir: '.',
  testMatch: ['<rootDir>/src/utils/test/**/*.test.{ts,js}'], // Prioritizes .ts files
  moduleNameMapping: {
    '^@kinvolk/headlamp-plugin/lib$': '<rootDir>/src/utils/test/__mocks__/headlamp-plugin.js'
  },
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
  setupFilesAfterEnv: ['<rootDir>/src/utils/test/setup.ts'], // TypeScript setup
  timeout: 30000                    // Extended timeout for complex tests
};
```

**Key Features:**
- ✅ **ts-jest preset** - Full TypeScript compilation and execution support
- ✅ **Type checking** - Jest runs TypeScript type checking during tests
- ✅ **Modern ES modules** - Support for import/export syntax
- ✅ **Mock isolation** - Automatic mock cleanup between tests`

### Mock Configuration (`__mocks__/headlamp-plugin.js`)

Mocks the `@kinvolk/headlamp-plugin/lib` module to avoid Azure CLI dependencies:

```javascript
module.exports = {
  runCommand: jest.fn().mockResolvedValue({
    stdout: '[]',
    stderr: '',
    code: 0,
  }),
};
```

## Test Files

### 🧪 TypeScript Test Suite Overview

All test files have been migrated to TypeScript for enhanced type safety and developer experience:

### 1. **Azure CLI Tests** (`az-cli-*.test.ts`)

**`az-cli-simple.test.ts`** - Core Azure CLI functionality:
- `isAzCliInstalled()` - CLI installation validation with type-safe responses
- `isAzCliLoggedIn()` - Authentication status checking with proper error handling
- Full TypeScript interfaces for CLI responses and error states

**`az-cli-final.test.ts`** - Extended Azure CLI testing:
- Advanced CLI command patterns and edge cases
- TypeScript-enhanced mock implementations
- Comprehensive error scenario coverage

### 2. **Azure Graph API Tests** (`graph-api.test.ts`)

Comprehensive TypeScript test suite for Azure Resource Graph API:
- **Subscriptions & Tenants**: `getSubscriptionsFromGraphAPI()`, `getTenantsFromGraphAPI()`
- **Resource Queries**: Resource groups, AKS clusters, container registries
- **Type-Safe Interfaces**: Comprehensive TypeScript definitions for all API responses
- **Error Handling**: Proper typing for API failures and fallback scenarios
- **Mocked Dependencies**: Full Azure SDK mocking with type safety:
  - `@azure/arm-resourcegraph` - Typed resource graph client
  - `@azure/arm-subscriptions` - Subscription management interfaces
  - `@azure/identity` - Authentication type definitions

### 3. **GitHub Integration Tests** (`github-api*.test.ts`)

**`github-api.test.ts`** - Core GitHub API functionality:
- Repository validation with typed responses
- Workflow file creation and management
- TypeScript interfaces for GitHub API responses

**`github-octokit.test.ts`** - Octokit integration testing:
- Advanced GitHub API patterns with full type safety
- Authentication handling with proper TypeScript error types
- Workflow automation testing with typed parameters

### 4. **Kubernetes Tests** (`kubectl.test.ts`)

TypeScript-enhanced kubectl command testing:
- Command execution with typed responses
- Namespace management with proper interfaces
- Error handling with TypeScript union types
- Mock kubectl responses with comprehensive type definitions

### 5. **Deployment & Application Tests**

**`deployment.test.ts`** - Application deployment functionality:
- Container deployment workflows with typed configurations
- YAML generation with TypeScript validation
- Error scenarios with proper type definitions

**`managed-namespaces.test.ts`** - Managed namespace operations:
- Namespace lifecycle management with type safety
- CLI integration testing with TypeScript interfaces
- Resource validation with comprehensive type checking

### 6. **Utility Tests**

**`test-registry-validation.test.ts`** - Container registry validation:
- Registry connectivity testing with typed responses
- Authentication validation with proper error interfaces
- Performance testing with TypeScript timing types

**`simple-jest.test.ts`** - Jest framework verification:
- Basic Jest functionality validation with TypeScript
- Mock system testing with type-safe implementations
- Configuration validation with typed Jest interfaces

### 🎯 TypeScript Demo Files

#### `graph-api-demo.ts` - Azure Graph API Demonstration

**TypeScript-enhanced standalone demo** of Graph API functionality:

- **Type-Safe Mocking**: Comprehensive TypeScript interfaces for Azure SDK responses
- **Realistic Mock Data**: Fully typed mock subscriptions, clusters, and resource groups
- **Error Handling**: Proper TypeScript error types and exception handling
- **Query Simulation**: Resource Graph query execution with typed parameters
- **Educational Tool**: Perfect for understanding API patterns with IntelliSense support
- **Execution**: `npx ts-node src/utils/test/graph-api-demo.ts`

**Features:**
- ✅ Comprehensive TypeScript interfaces for all Azure resources
- ✅ Type-safe mock implementations with realistic data structures
- ✅ Error scenario demonstrations with proper typing
- ✅ Interactive console output with emoji indicators

#### `github-api-demo.ts` - GitHub API Demonstration

**TypeScript-enhanced standalone demo** of GitHub API functionality:

- **Octokit Integration**: Full TypeScript support with GitHub API v4 types
- **Repository Operations**: Typed repository validation and workflow management
- **Authentication Patterns**: TypeScript error handling for auth scenarios
- **Workflow Automation**: Type-safe workflow file creation and management
- **Educational Tool**: Understanding GitHub integration patterns with full IntelliSense
- **Execution**: `npx ts-node src/utils/test/github-api-demo.ts`

**Features:**
- ✅ Complete GitHub API TypeScript interfaces and response types
- ✅ Type-safe Octokit client mocking with realistic response data
- ✅ Comprehensive error handling with proper TypeScript union types
- ✅ Interactive demonstration with detailed console logging

### 7. Legacy Test Infrastructure

Basic Jest tests to verify configuration:

- Simple arithmetic tests
- Jest globals availability
- Mock function creation

### 6. `run-tests.js`

Flexible test runner that can operate in different modes:

- **Simple Mode**: Runs JavaScript test file directly with Node.js
- **Jest Mode**: Full Jest test execution with configuration
- Handles both TypeScript and JavaScript tests

### 7. `setup.ts`

Jest setup configuration file referenced in `jest.config.utils.js`.

## CI/CD Integration

### GitHub Actions

Add to your workflow:

```yaml
- name: Run utility tests
  run: npm run test:utils:simple
```

### Alternative Jest approach

```yaml
- name: Run comprehensive tests
  run: npm run test:utils:jest
```

## Troubleshooting

### TypeScript Jest Issues

If you encounter TypeScript compilation errors with Jest:

1. Use the simple test runner: `npm run test:utils:simple`
2. Check that `@types/jest` is installed: `npm install --save-dev @types/jest`
3. Verify `jest.config.utils.js` configuration
4. Consider using JavaScript test files instead of TypeScript

### Mock Issues

If mocking isn't working:

1. Check that mock files are in the correct location
2. Verify `moduleNameMapping` in Jest configuration
3. Ensure `clearMocks: true` in Jest configuration
4. Use `jest.clearAllMocks()` in test setup

### Azure CLI Dependencies

The tests are designed to run without Azure CLI:

- All Azure CLI commands are mocked
- No authentication required
- No actual Azure resources are accessed
- Safe for CI/CD environments

## 🎯 TypeScript Testing Best Practices

1. **TypeScript First**: Always write new tests in TypeScript with comprehensive interfaces
2. **Type Safety**: Define proper TypeScript interfaces for all mock data and API responses
3. **Jest + ts-jest**: Use the Jest test runner with ts-jest for optimal TypeScript support
4. **Mock All External Dependencies**: Never make actual Azure CLI calls in tests - use typed mocks
5. **Interface-Driven Testing**: Focus on testing API contracts with proper TypeScript types
6. **Test Independence**: Each test should run in isolation with proper mock cleanup
7. **Descriptive Typing**: Use comprehensive TypeScript types that document expected behavior
8. **Error Type Safety**: Define proper TypeScript union types for error scenarios
9. **IntelliSense Benefits**: Leverage TypeScript's IntelliSense for better test development experience
10. **Demo Files**: Use TypeScript demo files for understanding complex API integrations

## 🚀 Adding New TypeScript Tests

To add new TypeScript utility tests:

1. **Create `.test.ts` files** in `src/utils/test/` directory
2. **Define TypeScript interfaces** for all mock data and expected responses
3. **Use typed mocks** for the `@kinvolk/headlamp-plugin/lib` module
4. **Add test scripts** to `package.json` if needed
5. **Update documentation** with any new test categories

## 📝 TypeScript Test Structure Example

```typescript
// Define TypeScript interfaces for type safety
interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

interface MockRunCommand {
  (args: string[]): Promise<CommandResult>;
}

// Mock the headlamp-plugin with proper TypeScript typing
const mockRunCommand = jest.fn<Promise<CommandResult>, [string[]]>();
jest.mock('@kinvolk/headlamp-plugin/lib', () => ({
  runCommand: mockRunCommand,
}));

// Import your utility function with proper typing
import { yourUtilityFunction } from '../your-utility';

describe('Your Utility Function', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should handle expected input with type safety', async () => {
    // Setup typed mock response
    const expectedResult: CommandResult = {
      stdout: 'expected output',
      stderr: '',
      code: 0,
    };

    mockRunCommand.mockResolvedValue(expectedResult);

    // Test your function with TypeScript support
    const result = await yourUtilityFunction(['test', 'args']);

    // Verify behavior with type checking
    expect(mockRunCommand).toHaveBeenCalledWith(['expected', 'args']);
    expect(result).toEqual(expectedResult);
  });

  it('should handle error scenarios with proper typing', async () => {
    // Type-safe error scenario
    const errorResult: CommandResult = {
      stdout: '',
      stderr: 'Command failed',
      code: 1,
    };

    mockRunCommand.mockResolvedValue(errorResult);

    await expect(yourUtilityFunction(['failing', 'args'])).rejects.toThrow(
      'Expected error message'
    );
  });
});
```

### 🎯 TypeScript Testing Benefits

- ✅ **Compile-time Type Checking**: Catch errors before tests run
- ✅ **IntelliSense Support**: Auto-completion for test development
- ✅ **Interface Documentation**: Self-documenting test code with types
- ✅ **Refactoring Safety**: TypeScript ensures test compatibility during refactoring
- ✅ **Mock Type Safety**: Prevent mock configuration errors with proper typing

This testing setup ensures your utility functions can be tested thoroughly without requiring Azure CLI authentication, making them perfect for CI/CD environments.

```

## Why This Approach?

Traditional testing of Azure CLI utilities requires:
- Azure CLI installation
- Valid authentication
- Network connectivity
- External dependencies

Our mocking approach eliminates these requirements while maintaining test coverage and reliability.

## Test Scenarios

### Azure CLI Tests
- CLI installation detection
- Login status verification
- Command execution patterns
- Error handling

### Azure Resource Graph API Tests
- Subscription and tenant enumeration
- Resource Graph query construction and execution
- AKS cluster information retrieval
- Resource group and container registry queries
- Error handling for API failures
- Data transformation and default value handling
- Azure SDK dependency mocking

### GitHub API Tests
- Repository validation
- Workflow file creation
- Authentication handling
- Network error scenarios

## 🎉 TypeScript Migration Summary

### ✅ **Complete TypeScript Conversion**
- **59 tests** across **10 test suites** - 100% TypeScript coverage
- **All test files** migrated from `.js` to `.ts` with comprehensive type safety
- **Demo files** converted to TypeScript with enhanced interfaces and error handling
- **Zero JavaScript test files** remaining (except utility scripts)

### 🚀 **Enhanced Developer Experience**
- **Full IntelliSense support** in VS Code with auto-completion and error detection
- **Compile-time type checking** prevents runtime errors in test scenarios
- **Self-documenting code** through comprehensive TypeScript interfaces
- **Better refactoring support** with IDE-assisted code navigation

### 🛡️ **Improved Type Safety**
- **Comprehensive interfaces** for all Azure SDK responses and CLI outputs
- **Union types** for proper error handling and status validation
- **Generic types** for reusable mock implementations and test utilities
- **Strict typing** for API parameters and response validation

### 🧪 **Robust Testing Infrastructure**
- **Mock-based testing** eliminating external dependencies and authentication requirements
- **CI/CD optimized** for reliable execution in automated environments
- **Jest + ts-jest integration** providing modern testing framework with TypeScript support
- **Standalone demo files** for understanding and debugging API integrations

### 📊 **Test Coverage Highlights**
| Category | Files | Coverage |
|----------|-------|----------|
| 🔧 Azure CLI | `az-cli-*.test.ts` | Installation, authentication, command execution |
| 📊 Graph API | `graph-api.test.ts` | Resource queries, subscriptions, error handling |
| 🐙 GitHub API | `github-api*.test.ts` | Repository management, workflow automation |
| ⚙️ Kubernetes | `kubectl.test.ts` | Command execution, namespace management |
| 🚀 Deployment | `deployment.test.ts`, `managed-namespaces.test.ts` | Application deployment workflows |
| 🛠️ Utilities | Various `.test.ts` files | Registry validation, performance testing |

This TypeScript-first testing approach ensures **reliable, maintainable, and type-safe** testing infrastructure that supports continuous integration and provides an excellent developer experience.

For detailed documentation, see [TESTING_UTILS.md](../docs/TESTING_UTILS.md).
```
````
