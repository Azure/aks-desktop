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

# Validate tarball contents to prevent path traversal, absolute paths, or symlink/hardlink escape
while IFS= read -r line; do
  # The first character of the mode field indicates the entry type: '-', 'd', 'l', 'h', etc.
  type_char=${line:0:1}
  # Extract the path as the last whitespace-separated field on the line.
  entry=${line##* }
  # Reject symlink and hardlink entries entirely to prevent link traversal attacks.
  if [[ "$type_char" == "l" || "$type_char" == "h" ]]; then
    echo "Error: Unsafe link entry detected in tarball: $entry" >&2
    rm -f artifacts.tar.gz
    exit 1
  fi
  # Reject absolute paths or any path containing '..'.
  if [[ "$entry" = /* ]] || [[ "$entry" == *"../"* ]]; then
    echo "Error: Unsafe path detected in tarball entry: $entry" >&2
    rm -f artifacts.tar.gz
    exit 1
  fi
done < <(tar -tvzf artifacts.tar.gz)

tar --no-same-owner --no-same-permissions -xzf artifacts.tar.gz --strip-components=1 -C dist
rm artifacts.tar.gz
echo "Done."
