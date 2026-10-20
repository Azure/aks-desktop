// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

const defaults = require('@kinvolk/headlamp-plugin/config/i18next-parser.config.js');

module.exports = {
  ...defaults,
  // Retain approved translations when a UI change stops referencing their keys.
  keepRemoved: true,
};
