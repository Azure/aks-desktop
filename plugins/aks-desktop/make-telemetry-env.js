// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// Writes a .env file consumed by the headlamp-plugin Vite build, which
// substitutes REACT_APP_* vars as `import.meta.env.*` in the plugin
// bundle. Runs as a prebuild/prestart hook from package.json.
//
// REACT_APP_APPINSIGHTS_CONNECTION_STRING defaults to the public AKS
// Desktop production App Insights instance. The connection string is
// not a credential (App Insights connection strings are addresses, not
// auth tokens) and was previously hardcoded in
// headlamp/frontend/make-env.js. To send to a different instance (e.g.
// the dev App Insights), set the env var before running the build.

const fs = require('fs');
const path = require('path');

const DEFAULT_CONNECTION_STRING =
  'InstrumentationKey=5f8e9ae9-1e90-4ab7-8aeb-429b5a3bf73b;IngestionEndpoint=https://eastus-8.in.applicationinsights.azure.com/;LiveEndpoint=https://eastus.livediagnostics.monitor.azure.com/;ApplicationId=e50d3436-371c-4165-bd66-c17b1f551dfe';

const CONNECTION_STRING =
  process.env.REACT_APP_APPINSIGHTS_CONNECTION_STRING || DEFAULT_CONNECTION_STRING;

const fileName = process.argv[2] || '.env';
const out = `REACT_APP_APPINSIGHTS_CONNECTION_STRING=${CONNECTION_STRING}\n`;
fs.writeFileSync(path.join(__dirname, fileName), out);
