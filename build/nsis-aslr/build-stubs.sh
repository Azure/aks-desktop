#!/bin/sh
# Rebuild in a disposable, pinned linux/amd64 container; export one stub only.
set -eu

usage() {
	printf '%s\n' \
		'Usage: build-stubs.sh [--check]' \
		'       build-stubs.sh --help' \
		'' \
		'Without arguments, replace stubs/zlib-x86-unicode and stubs.sha256.' \
		'--check rebuilds and compares both the manifest and repository bytes without writing them.' \
		'Requires Docker (linux/amd64 support), curl and GNU coreutils; downloads pinned sources/packages.'
}

CHECK=no
case "$#" in
	0) ;;
	1)
		case "$1" in
			--check) CHECK=yes ;;
			-h | --help)
				usage
				exit 0
				;;
			*)
				echo "Unknown argument: $1" >&2
				usage >&2
				exit 2
				;;
		esac
		;;
	*)
		usage >&2
		exit 2
		;;
esac

RECIPE=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# These repository-owned locks are shell assignments, not user configuration.
. "$RECIPE/nsis-source.lock"
. "$RECIPE/toolchain.lock"

for tool in curl docker sha256sum cmp mktemp awk; do
	if ! command -v "$tool" > /dev/null 2>&1; then
		echo "Required command not found: $tool" >&2
		exit 1
	fi
done

TEMP=$(mktemp -d "${TMPDIR:-/tmp}/nsis-stubs.XXXXXXXX")
trap 'rm -rf "$TEMP"' 0
trap 'exit 1' HUP INT TERM
# Resolve a relative TMPDIR before handing bind paths to Docker.
TEMP=$(CDPATH='' cd -- "$TEMP" && pwd)
mkdir "$TEMP/out"

curl --fail --location --retry 3 --proto '=https' --proto-redir '=https' \
	--output "$TEMP/nsis-3.04-src.tar.bz2" "$SOURCE_URL"
ACTUAL_SHA256=$(sha256sum "$TEMP/nsis-3.04-src.tar.bz2" | awk '{print $1}')
if [ "$ACTUAL_SHA256" != "$SOURCE_SHA256" ]; then
	echo "Source SHA-256 mismatch: expected $SOURCE_SHA256, got $ACTUAL_SHA256" >&2
	exit 1
fi

# No reusable build container, custom image, writable source tree or package cache.
docker run --rm --platform linux/amd64 \
	--mount "type=bind,src=$RECIPE,dst=/recipe,readonly" \
	--mount "type=bind,src=$TEMP/nsis-3.04-src.tar.bz2,dst=/src/nsis-3.04-src.tar.bz2,readonly" \
	--mount "type=bind,src=$TEMP/out,dst=/out" \
	"$IMAGE" /bin/sh /recipe/container-build.sh

(cd "$TEMP/out" && sha256sum --check stubs.sha256)
STUB_SHA256=$(sha256sum "$TEMP/out/zlib-x86-unicode" | awk '{print $1}')
printf '%s  stubs/zlib-x86-unicode\n' "$STUB_SHA256" > "$TEMP/stubs.sha256"

if [ "$CHECK" = yes ]; then
	if ! cmp -s "$TEMP/stubs.sha256" "$RECIPE/stubs.sha256"; then
		echo 'Rebuilt manifest differs from stubs.sha256; inspect the recipe/toolchain drift.' >&2
		exit 1
	fi
	if ! cmp -s "$TEMP/out/zlib-x86-unicode" "$RECIPE/stubs/zlib-x86-unicode"; then
		echo 'Rebuilt stub differs from repository bytes; inspect stubs/zlib-x86-unicode.' >&2
		exit 1
	fi
	echo 'Verified: rebuilt manifest and stub match repository bytes.'
else
	mkdir -p "$RECIPE/stubs"
	cp "$TEMP/out/zlib-x86-unicode" "$RECIPE/stubs/zlib-x86-unicode"
	cp "$TEMP/stubs.sha256" "$RECIPE/stubs.sha256"
	echo 'Exported stubs/zlib-x86-unicode and stubs.sha256.'
fi
