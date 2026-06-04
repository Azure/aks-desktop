// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// Writes a .env file consumed by the headlamp-plugin Vite build, which
// substitutes REACT_APP_* vars as `import.meta.env.*` in the plugin
// bundle. Runs as a prebuild/prestart hook from package.json.
//
// The default REACT_APP_APPINSIGHTS_CONNECTION_STRING points at the AKS
// Desktop production App Insights instance. Connection strings are
// addresses (not credentials). Set the env var before running the build
// to send to a different instance (e.g. a dev App Insights).

const fs = require('fs');
const path = require('path');

const DEFAULT_CONNECTION_STRING =
  'InstrumentationKey=5f8e9ae9-1e90-4ab7-8aeb-429b5a3bf73b;IngestionEndpoint=https://eastus-8.in.applicationinsights.azure.com/;LiveEndpoint=https://eastus.livediagnostics.monitor.azure.com/;ApplicationId=e50d3436-371c-4165-bd66-c17b1f551dfe';

const CONNECTION_STRING =
  process.env.REACT_APP_APPINSIGHTS_CONNECTION_STRING || DEFAULT_CONNECTION_STRING;

const fileName = process.argv[2] || '.env';
const out = `REACT_APP_APPINSIGHTS_CONNECTION_STRING=${CONNECTION_STRING}\n`;
fs.writeFileSync(path.join(__dirname, fileName), out);
