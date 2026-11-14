#!/bin/sh
# Runs INSIDE the pinned container (see toolchain.lock IMAGE). Builds the
# NSIS 3.04 stubs from the authenticated source tarball and the two patches
# in this directory, with the exact pinned toolchain, and exports only
# Stubs/zlib-x86-unicode plus its SHA-256. Never run this directly on a host;
# use build-stubs.sh, which runs it inside the pinned image.
#
# Expected bind mounts (read-only unless noted):
#   /recipe/nsis-source.lock
#   /recipe/toolchain.lock
#   /recipe/patches/0001-scons-python3.patch
#   /recipe/patches/0002-reloc-before-ndata.patch
#   /src/nsis-3.04-src.tar.bz2   (the tarball itself)
#   /out                         (writable; stub + hash land here)
set -eu

RECIPE=/recipe
SRC_TARBALL=/src/nsis-3.04-src.tar.bz2
OUT=/out
WORK=/work

. "$RECIPE/nsis-source.lock"
. "$RECIPE/toolchain.lock"

echo "== verifying source tarball hash =="
ACTUAL_SHA256=$(sha256sum "$SRC_TARBALL" | awk '{print $1}')
if [ "$ACTUAL_SHA256" != "$SOURCE_SHA256" ]; then
	echo "REFUSING: $SRC_TARBALL sha256 $ACTUAL_SHA256 != pinned $SOURCE_SHA256" >&2
	exit 1
fi
echo "ok: $ACTUAL_SHA256"

echo "== pinning apt to the dated snapshot only =="
export DEBIAN_FRONTEND=noninteractive
rm -f /etc/apt/sources.list.d/*
rm -f /etc/apt/sources.list
rm -rf /var/lib/apt/lists/*
printf 'deb [check-valid-until=no] %s %s main\n' "$SNAPSHOT_BASE_URL" "$DEBIAN_SUITE" > /etc/apt/sources.list
cat /etc/apt/sources.list

apt-get -o Acquire::Check-Valid-Until=false update -qq

echo "== installing pinned packages (fails closed on any version drift) =="
apt-get -o Acquire::Check-Valid-Until=false -y -qq --no-install-recommends install \
	"$PACKAGE_SCONS" "$PACKAGE_PYTHON3" "$PACKAGE_GCC_MINGW" "$PACKAGE_GXX_MINGW" \
	"$PACKAGE_BINUTILS_MINGW" "$PACKAGE_GCC" "$PACKAGE_GXX" "$PACKAGE_PATCH" \
	"$PACKAGE_BZIP2" "$PACKAGE_TAR" "$PACKAGE_ZLIB_DEV"

echo "== resolved tool versions =="
dpkg-query -W -f='${Package}=${Version}\n' scons python3 gcc-mingw-w64-i686 g++-mingw-w64-i686 binutils-mingw-w64-i686
i686-w64-mingw32-gcc --version | head -1
i686-w64-mingw32-ld --version | head -1
scons --version

echo "== extracting source =="
rm -rf "$WORK" && mkdir -p "$WORK"
tar xjf "$SRC_TARBALL" -C "$WORK" --strip-components=1
cd "$WORK"

echo "== applying patches (in series) =="
patch -p1 < "$RECIPE/patches/0001-scons-python3.patch"
patch -p1 < "$RECIPE/patches/0002-reloc-before-ndata.patch"

echo "== building stubs (SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH) =="
export SOURCE_DATE_EPOCH
export TZ=UTC
scons -j"$(nproc)" \
	XGCC_W32_PREFIX=i686-w64-mingw32- \
	NSIS_MAX_STRLEN=8192 \
	UNICODE=yes \
	VERSION=v3.04 VER_MAJOR=3 VER_MINOR=0 VER_REVISION=4 VER_BUILD=0 \
	SKIPUTILS=all SKIPPLUGINS=all SKIPMISC=all SKIPDOC=all \
	APPEND_CCFLAGS="-fno-tree-loop-distribute-patterns" \
	stubs

echo "== locating the active stub =="
STUB_DIR="build/urelease/stub_zlib-x86-unicode"
STUB_FILE="$STUB_DIR/stub_zlib.exe"
if [ ! -f "$STUB_FILE" ]; then
	echo "REFUSING: expected stub not found at $STUB_FILE" >&2
	ls -la "$STUB_DIR" >&2 || true
	exit 1
fi

mkdir -p "$OUT"
cp "$STUB_FILE" "$OUT/zlib-x86-unicode"
(cd "$OUT" && sha256sum zlib-x86-unicode > stubs.sha256)
echo "== done =="
cat "$OUT/stubs.sha256"
