## Azure Auth Headlamp plugin

This plugin exposes functions to enable Azure Authentication.
The plugin consists of two parts:

1. `src-bin/azure-api.ts`

A small CLI utility script that is bundled to `azure-api.js` and run by the Headlamp app in Node.js.
It uses `@azure/identity` and its interactive browser credential to perform basic operations like logging in and out and requesting auth tokens.

2. `src/index.tsx`

A bridge that calls the utility and exposes an Azure SDK compatible credential. It adds a `window.azureAuth` property.