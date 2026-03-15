# Plugins

This directory contains the plugins for the AKS desktop application.

## Structure

- `aks-desktop/` - The main AKS desktop plugin for Headlamp
  - Contains the TypeScript source code, configuration files, and tests
  - Built and deployed as a Headlamp plugin
- `ai-assistant/` - AI Assistant plugin for Headlamp (Preview)
  - Provides conversational AI capabilities for Kubernetes cluster management
  - Disabled by default; must be enabled in Settings
  - See [ai-assistant/README.md](ai-assistant/README.md) for details

## Building Plugins

To build all plugins, use the build script from the root directory:

```bash
npx tsx ./build/setup-plugins.ts
```

This script will for each plugin:
1. Navigate to the plugin directory
2. Install dependencies
3. Build the plugin
4. Copy the built plugin to the Headlamp plugins directory

## Development

Each plugin has its own package.json and can be developed independently:

```bash
cd plugins/aks-desktop   # or plugins/ai-assistant
npm install
npm run start  # For development mode
npm run build  # For production build
```
