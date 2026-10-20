# Plugins

This directory contains the plugins for the AKS desktop application.

## Structure

- `aks-desktop/` - The main AKS desktop plugin for Headlamp
  - Contains the TypeScript source code, configuration files, and tests
  - Built and deployed as a Headlamp plugin

AI Assistant is pinned as a verified GitHub release in the root product
manifest rather than maintained as an in-repository plugin workspace.

## Building Plugins

To build all plugins, use the build script from the root directory:

```bash
npm run plugin:setup
```

For each workspace plugin declared in `package.json#headlamp.plugins`, the
source-package bundler will:

1. Navigate to the plugin directory
2. Install dependencies
3. Build the plugin
4. Copy the compiled files into Headlamp's local `.plugins` directory so the
  app can load and package them

Release plugins are downloaded from their pinned manifest URL, checksum
verified, and extracted directly into the same `.plugins` directory.

## Development

Each plugin has its own package.json and can be developed independently:

```bash
cd plugins/aks-desktop
npm install
npm run start  # For development mode
npm run build  # For production build
```
