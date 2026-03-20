#!/usr/bin/env bash
# Copyright (c) Microsoft Corporation.
# Licensed under the Apache 2.0.
set -euo pipefail
cd "$(dirname "$0")/.."

failures=0
check() { local desc="$1"; shift; if "$@"; then echo "PASS: ${desc}"; else echo "FAIL: ${desc}"; failures=$((failures+1)); fi; }

check 'main.js exists and is non-empty' test -s dist/main.js
check 'main.wasm.gz exists and is non-empty' test -s dist/main.wasm.gz
check 'main.wasm.gz contains valid WASM' bash -c '[ "$(gunzip -c dist/main.wasm.gz | xxd -l 4 -p)" = "0061736d" ]'

if [ "$failures" -gt 0 ]; then
  echo -e "\n${failures} validation(s) failed."
  exit 1
fi
echo -e "\nAll validations passed."
