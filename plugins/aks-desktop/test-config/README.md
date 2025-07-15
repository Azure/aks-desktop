# 🧪 Test Configuration Directory

This directory contains all testing-related configuration files organized for better maintainability.

## 📁 Directory Structure

```
test-config/
├── babel/              # Babel transformation configurations
│   ├── .babelrc.enhanced.json    # Advanced Babel features demo
│   ├── .babelrc.rtl.json         # Babel config for RTL tests
│   └── .babelrc.test.json        # Standard Babel test config
├── jest/               # Jest test runner configurations
│   ├── jest.config.babel.js      # Babel-based Jest config
│   ├── jest.config.components.js # React component testing (ts-jest)
│   ├── jest.config.rtl.js        # React Testing Library config
│   └── jest.config.utils.js      # Utility function testing
└── setup/              # Test environment setup files
    ├── setupTests-main.ts        # Main setupTests from src/
    ├── setupTests.js             # JavaScript setup for RTL tests
    └── setupTests.ts             # TypeScript setup for components
```

## 🎯 Configuration Purposes

### Jest Configurations

| Config File                 | Purpose                 | Environment | Transformation |
| --------------------------- | ----------------------- | ----------- | -------------- |
| `jest.config.utils.js`      | Utility/API testing     | Node.js     | ts-jest        |
| `jest.config.components.js` | React components        | jsdom       | ts-jest        |
| `jest.config.rtl.js`        | React Testing Library   | jsdom       | babel-jest     |
| `jest.config.babel.js`      | Advanced Babel features | jsdom       | babel-jest     |

### Babel Configurations

| Config File              | Purpose          | Features              |
| ------------------------ | ---------------- | --------------------- |
| `.babelrc.test.json`     | Standard testing | Basic presets         |
| `.babelrc.rtl.json`      | RTL testing      | React + TypeScript    |
| `.babelrc.enhanced.json` | Advanced demo    | Full plugin ecosystem |

### Setup Files

| Setup File           | Purpose          | Used By           |
| -------------------- | ---------------- | ----------------- |
| `setupTests-main.ts` | Main test setup  | Component configs |
| `setupTests.js`      | JavaScript setup | RTL config        |
| `setupTests.ts`      | TypeScript setup | Component configs |

## 🚀 Usage

### Running Tests

```bash
# Utility tests (Node.js environment)
npm run test:utils

# Component tests (ts-jest)
npm run test:components

# RTL tests (babel-jest)
npm run test:rtl

# All tests
npm run test:all
```

### Adding New Configurations

1. **New Jest Config**: Add to `test-config/jest/`
2. **New Babel Config**: Add to `test-config/babel/`
3. **New Setup File**: Add to `test-config/setup/`
4. **Update package.json**: Add script referencing new config

### Configuration Relationships

```
package.json scripts
    ↓
test-config/jest/*.js (Jest configs)
    ↓
test-config/babel/*.json (Babel configs)
    ↓
test-config/setup/* (Setup files)
```

## 📋 Migration Notes

**Files moved from root:**

- `jest.config.*.js` → `test-config/jest/`
- `.babelrc*.json` → `test-config/babel/`
- `src/components/__tests__/setupTests.*` → `test-config/setup/`

**Updated references:**

- package.json scripts now point to `test-config/jest/`
- Jest configs reference `test-config/setup/` for setup files
- Jest configs reference `test-config/babel/` for Babel configs

This organization provides:

- ✅ Clear separation of concerns
- ✅ Easy maintenance and updates
- ✅ Better discoverability
- ✅ Consistent file organization
