#!/usr/bin/env bash
# Copyright (c) Microsoft Corporation.
# Licensed under the Apache 2.0.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
URL="https://github.com/inspektor-gadget/insights-plugin/releases/download/v${VERSION}/insights-plugin-${VERSION}.tar.gz"
echo "Downloading insights-plugin v${VERSION}..."
rm -rf dist
mkdir -p dist
curl --retry 5 --retry-delay 5 --retry-all-errors --connect-timeout 10 --max-time 120 -fLo artifacts.tar.gz "$URL"

# We know exactly the files we want to extract, so we name them here to skip any fancy filename sanity checks
tar --no-same-owner --no-same-permissions -xzf artifacts.tar.gz \
  --strip-components=1 -C dist \
  insights-plugin/main.js \
  insights-plugin/main.wasm.gz \
  insights-plugin/package.json \
  insights-plugin/locales/en/translation.json \
  insights-plugin/locales/de/translation.json
rm artifacts.tar.gz
echo "Done."
