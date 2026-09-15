// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

'use strict';

const path = require('node:path');

let nativeKeytar;

/** Load the keytar binary matching the current macOS architecture. */
const loadNativeKeytar = () => {
  if (process.platform !== 'darwin') {
    throw new Error(`Keytar is not available on ${process.platform}`);
  }

  if (process.arch !== 'arm64' && process.arch !== 'x64') {
    throw new Error(`Keytar is not available for macOS ${process.arch}`);
  }

  nativeKeytar ??= require(
    path.join(__dirname, '..', 'bin', `${process.platform}-${process.arch}`, 'keytar.node')
  );
  return nativeKeytar;
};

/** Validate a required keytar argument. */
const checkRequired = (value, name) => {
  if (!value || value.length <= 0) {
    throw new Error(`${name} is required.`);
  }
};

module.exports = {
  getPassword(service, account) {
    checkRequired(service, 'Service');
    checkRequired(account, 'Account');
    return loadNativeKeytar().getPassword(service, account);
  },
  setPassword(service, account, password) {
    checkRequired(service, 'Service');
    checkRequired(account, 'Account');
    checkRequired(password, 'Password');
    return loadNativeKeytar().setPassword(service, account, password);
  },
  deletePassword(service, account) {
    checkRequired(service, 'Service');
    checkRequired(account, 'Account');
    return loadNativeKeytar().deletePassword(service, account);
  },
  findPassword(service) {
    checkRequired(service, 'Service');
    return loadNativeKeytar().findPassword(service);
  },
  findCredentials(service) {
    checkRequired(service, 'Service');
    return loadNativeKeytar().findCredentials(service);
  },
};
