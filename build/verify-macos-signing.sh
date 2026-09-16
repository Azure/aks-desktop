#!/bin/bash
# Copyright (c) Microsoft Corporation.
# Licensed under the Apache 2.0.
set -euo pipefail

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[[ $# == 3 ]] || die "Usage: $0 <signed|notarized> <dmg-directory> <expected-bundle-id>"
mode=$1
directory=$2
expected_bundle_id=$3
[[ $mode == signed || $mode == notarized ]] || die "Unknown verification mode: $mode"
[[ -d $directory ]] || die "Missing DMG directory: $directory"
[[ $expected_bundle_id =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]] || die 'Invalid expected bundle ID'

# Captured diagnostics must not turn a failed command into a successful text match.
capture() {
  local output status
  if output=$("$@" 2>&1); then
    printf '%s\n' "$output"
  else
    status=$?
    printf '%s\n' "$output" >&2
    return "$status"
  fi
}
verify_identity() {
  local details line authority='missing' team=''
  details=$(capture codesign -dvvv "$1")
  printf '%s\n' "$details"
  while IFS= read -r line; do
    case $line in
      Authority=*) [[ $authority != missing ]] || authority=${line#Authority=} ;;
      TeamIdentifier=*) team=${line#TeamIdentifier=} ;;
    esac
  done <<< "$details"
  [[ $authority == 'Developer ID Application: Microsoft Corporation (UBF8T346G9)' && $team == UBF8T346G9 ]] ||
    die "Unexpected Developer ID identity on $1"
}

assess_notarization() {
  local target=$1 details
  shift
  details=$(capture spctl --assess --verbose=2 "$@" "$target")
  printf '%s\n' "$details"
  if ! grep -Fx -- "$target: accepted" <<< "$details" > /dev/null ||
     ! grep -Fx 'source=Notarized Developer ID' <<< "$details" > /dev/null; then
    die "Missing positive Gatekeeper notarization evidence for $target"
  fi
}

scratch=$(mktemp -d "${TMPDIR:-/tmp}/verify-macos-signing.XXXXXX")
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
shopt -s nullglob dotglob
find "$directory" -type f -name '*.dmg' -print0 > "$scratch/dmgs"
[[ -s $scratch/dmgs ]] || die "No DMG files found in $directory"
while IFS= read -r -d '' dmg; do
  codesign --verify --strict "$dmg"
  verify_identity "$dmg"
  mount_dir="$scratch/mount"
  mkdir -p "$mount_dir"
  hdiutil attach "$dmg" -mountpoint "$mount_dir" -readonly -nobrowse -quiet
  apps=("$mount_dir"/*.app)
  [[ ${#apps[@]} == 1 ]] || die "Expected exactly one root app in $dmg; found ${#apps[@]}"
  app=${apps[0]}
  [[ -d $app && ! -L $app ]] || die "Root app must be a directory, not a symlink: $app"
  [[ -f $app/Contents/Info.plist ]] || die "Missing Info.plist in $app"
  bundle_id=$(plutil -extract CFBundleIdentifier raw -o - "$app/Contents/Info.plist")
  [[ $bundle_id == "$expected_bundle_id" ]] || die "Bundle ID mismatch in $dmg: expected $expected_bundle_id, got $bundle_id"
  codesign --verify --deep --strict "$app"
  verify_identity "$app"
  printf '✅ DMG is signed with Developer ID\n'
  if [[ $mode == notarized ]]; then
    # Validate the distribution DMG ticket without requiring a separate app staple.
    xcrun stapler validate "$dmg"
    assess_notarization "$dmg" --type open --context context:primary-signature
    assess_notarization "$app" --type execute
    printf '✅ App is notarized and accepted by Gatekeeper\n'
  fi
  hdiutil detach "$mount_dir" -quiet
  mount_dir=''
done < "$scratch/dmgs"
rm -rf "$scratch"
trap - EXIT
if [[ $mode == signed ]]; then
  printf '✅ Bundle ID: %s\n' "$bundle_id"
  printf '##vso[task.setvariable variable=BundleIdentifier;isOutput=true]%s\n' "$bundle_id"
  printf '=== DEVELOPER SIGNATURE VERIFICATION COMPLETE ===\n'
else
  printf '=== NOTARIZATION VERIFICATION COMPLETE ===\n'
fi
