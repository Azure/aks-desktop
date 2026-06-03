// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// CI/release pipeline MUST set REACT_APP_APPINSIGHTS_CONNECTION_STRING
// before invoking the plugin build. If unset, the plugin runs with
// telemetry disabled (fail-closed).

const fs = require('fs');
const path = require('path');

const CONNECTION_STRING = process.env.REACT_APP_APPINSIGHTS_CONNECTION_STRING || '';

const fileName = process.argv[2] || '.env';
const out = `REACT_APP_APPINSIGHTS_CONNECTION_STRING=${CONNECTION_STRING}\n`;
fs.writeFileSync(path.join(__dirname, fileName), out);
