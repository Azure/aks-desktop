#!/bin/bash
# Copyright (c) Microsoft Corporation.
# Licensed under the Apache 2.0.
set -euo pipefail

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[[ $# == 3 ]] || die "Usage: $0 <notarized-directory> <qualified-output-directory> <expected-bundle-id>"
[[ $(uname -s) == Darwin && $(uname -m) == arm64 ]] || die 'Qualification requires native Darwin arm64'
[[ $(node -p process.arch) == arm64 ]] || die 'Qualification requires native arm64 Node'
: "${BUILD_BUILDID:?Missing BUILD_BUILDID}" "${BUILD_SOURCEVERSION:?Missing BUILD_SOURCEVERSION}"
directory=$1
output=$2
bash build/verify-macos-signing.sh notarized "$directory" "$3"

scratch=$(mktemp -d "${TMPDIR:-/tmp}/qualify-macos-dmg.XXXXXX")
mount_dir=''
cleanup() {
  local status=$?
  trap - EXIT
  trap '' HUP INT TERM
  if [[ -n $mount_dir ]]; then
    if ! hdiutil detach "$mount_dir" -quiet && ! hdiutil detach "$mount_dir" -force -quiet; then
      # Never recursively remove a directory that may still contain a mounted image.
      printf 'ERROR: Could not detach %s; leaving mount directory intact\n' "$mount_dir" >&2
      [[ $status != 0 ]] || status=1
      exit "$status"
    fi
  fi
  rm -rf "$scratch" || { [[ $status != 0 ]] || status=1; }
  exit "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
find "$directory" -type f -name '*.dmg' -print0 > "$scratch/dmgs"
dmgs=()
while IFS= read -r -d '' dmg; do dmgs+=("$dmg"); done < "$scratch/dmgs"
[[ ${#dmgs[@]} == 1 ]] || die "Expected exactly one DMG; found ${#dmgs[@]}"
dmg=${dmgs[0]}
mount_dir="$scratch/mount"
mkdir "$mount_dir"
hdiutil attach "$dmg" -mountpoint "$mount_dir" -readonly -nobrowse -quiet
shopt -s nullglob dotglob
apps=("$mount_dir"/*.app)
[[ ${#apps[@]} == 1 ]] || die "Expected exactly one root app; found ${#apps[@]}"
[[ -d ${apps[0]} && ! -L ${apps[0]} ]] || die 'Root app must be a directory, not a symlink'
app="$scratch/$(basename "${apps[0]}")"
ditto "${apps[0]}" "$app"
hdiutil detach "$mount_dir" -quiet
mount_dir=''
codesign --verify --deep --strict "$app"
executable=$(plutil -extract CFBundleExecutable raw -o - "$app/Contents/Info.plist")
[[ -n $executable && $executable != */* && $executable != . && $executable != .. ]] || die 'Invalid bundle executable'
[[ -x $app/Contents/MacOS/$executable ]] || die 'Missing bundle executable'
mkdir -p "$scratch/home/config"
export HOME="$scratch/home" XDG_CONFIG_HOME="$scratch/home/config"
export AZURE_CONFIG_DIR="$HOME/.azure" PYTHONDONTWRITEBYTECODE=1
export AZURE_EXTENSION_USE_DYNAMIC_INSTALL=no AZURE_CORE_COLLECT_TELEMETRY=no
npm run test:post-build -- "--app=$app"
npm run headlamp:smoke -- --executable "$app/Contents/MacOS/$executable"
codesign --verify --deep --strict "$app"
# Cleanup is part of qualification, not a best-effort step after publication.
rm -rf "$scratch"
mkdir -p "$output"
cp "$dmg" "$output/$(basename "$dmg")"
printf 'Qualification run: %s\nSource: %s\n' "$BUILD_BUILDID" "$BUILD_SOURCEVERSION"
shasum -a256 "$output/$(basename "$dmg")"
