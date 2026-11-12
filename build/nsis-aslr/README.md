# NSIS ASLR stub recipe

This directory rebuilds **one** NSIS 3.04 stub, `stubs/zlib-x86-unicode`.
It is a PE32/x86 Unicode, non-solid zlib stub, shared by x64 and ARM64 payload
packaging. It is not a replacement NSIS distribution or compiler. Only pair it
with the Windows `Bin/makensis.exe` from electron-builder's **nsis-3.0.4.1**
bundle: v3.04, MAX_STRLEN8192, without NSIS_CONFIG_LOG. Keep all other bundle
files unchanged. Other compression modes, ANSI stubs and compiler versions
are outside this recipe's supported pairing.

## Provenance and changes

- Official `nsis-3.04-src.tar.bz2` from SourceForge, SHA-256
  `609536046c50f35cfd909dd7df2ab38f2e835d0da3c1048aa0d48c59c5a4f4f5`,
  cross-checked against upstream tag `v304`, commit
  `25cf71ac318c73016d0706add96f25ef70ccd4f7`. See [nsis-source.lock](nsis-source.lock).
- [0001-scons-python3.patch](patches/0001-scons-python3.patch) carries four
  build-script files from upstream Python 3 port
  `2aea5257709d81dded1ac66caabad6ccb543f446`. This includes
  `Docs/src/SConscript`, which SCons evaluates even with `SKIPDOC=all`.
  It changes no runtime `Source/exehead` code.
- [0002-reloc-before-ndata.patch](patches/0002-reloc-before-ndata.patch) moves
  `.reloc` before `.ndata` and `.rsrc`, so the relocation directory remains
  valid when makensis grows user-variable space and edits resources. It also
  suppresses the stub linker's PE timestamp. No runtime source edits are needed.
- [toolchain.lock](toolchain.lock) pins a Debian image digest, a dated package
  snapshot, exact direct package versions and SOURCE_DATE_EPOCH. Transitive
  dependencies resolve only from that snapshot. Package signatures remain
  required; only historical metadata expiry checks are disabled.

[NSIS-COPYING.txt](NSIS-COPYING.txt) is the source archive's unmodified COPYING,
including component notices and the applicable licenses.

## Rebuild or check

Use a POSIX shell host with Docker and `linux/amd64` execution support, curl,
GNU coreutils and awk. Docker bind mounts must refer to paths on the local
Docker host. Network access is required for the pinned image, source archive
and Debian snapshot. No custom registry, reusable build image or package cache
is required.

From the repository root:

```sh
# Replace only this directory's stub and one-entry manifest:
./build/nsis-aslr/build-stubs.sh

# Fresh rebuild; compare both manifest AND repository bytes without editing them:
./build/nsis-aslr/build-stubs.sh --check

# Check the exported bytes without rebuilding:
(cd build/nsis-aslr && sha256sum --check stubs.sha256)
```

The script works from other working directories too. Each invocation downloads
and verifies the source SHA-256, creates a fresh temporary output directory and
runs a disposable `linux/amd64` container. Recipe and source mounts are read-only;
only temporary output is writable. The container verifies the source again,
uses only the locked snapshot/packages, applies the patches and builds the
stubs. The host exports only the selected stub and `stubs.sha256`; temporary
files are removed on exit. Do not invoke `container-build.sh` on the host.

Two clean builds at these pins produced the same selected-stub SHA-256:
`a429190109de5b77a20bf5e2b6a08e4b626df5d8edc58930e65af6ca02c88333`.
If `--check` fails, investigate source, patch and toolchain drift before updating
the bytes or manifest. A compiler, template or compression change requires
revalidating the one-stub selection and Windows compiler pairing.

## Packaging and stock identity

`build/nsis-aslr/nsis-toolset.ts` makes an ordinary temporary copy of electron-builder's
stock bundle (about 7.3 MB), overlays this one stub, and checks its exact file
inventory. `stock-bundle.sha256` records the other 342 files from a fresh extraction
of the authenticated archive below, including `Bin/makensis.exe`, `elevate.exe`,
the other 11 stubs and `Stubs/uninst` (an icon). `stubs.sha256` authenticates the
replacement. The downloader's extraction cache is never modified. The separate
`nsis-resources-3.4.1` bundle is not covered by this manifest or repair.

Only Windows-host distributable packaging selects this copy; unpacked output
and other platforms are unchanged. The parent owns cleanup after packaging and
PE verification, even on failure. A caller toolset override is preserved and still
subject to the finished-installer gate. Windows copy/antivirus overhead needs CI
validation. Installed-config contracts guard effective NSIS-only targets (including
manifest replacements), Unicode, non-solid zlib, both toolset selectors, and explicit
or auto-discovered custom scripts/includes. Re-evaluate the replacement set if any
of those contracts changes.

## Stock regression fixture

`test-fixtures/stock-zlib-x86-unicode.headers.bin` is the first 1024 bytes
of `Stubs/zlib-x86-unicode` from the freshly extracted stock bundle, authenticated
against electron-builder's archive SHA-256
`9877df902530f96357d13a7a31ae2b9df67f48b11ffc9a1700a7c961574ec5fa`.
The full stock stub SHA-256 is
`aed7cb7405345d69121485184cf59b608686e144a19f5cf579b1adf5d97f7328`;
the header fixture SHA-256 is
`59311bccb5386a5d385810c1e40c1a9ead699de2959504bbe5cbaa7b00583eb1`.
It contains no executable body and demonstrates the stock RELOCS_STRIPPED failure.

## Proof limits

Local clean-build reproducibility and a small Windows-compiler probe under Wine
with resource edits and enlarged user-variable space establish only those
exercised paths. The pinned stub and compiled probe retained valid relocations;
the probe also ran after an offline rebase (with its modified-file CRC check
disabled for that throwaway test). This is not a real Windows loader ASLR test
or a full electron-builder packaging test.

This recipe does not establish CI reproduction, real Windows packaging,
signing, install/upgrade/uninstall, installed-uninstaller behavior, or Windows
Guardian/BinSkim acceptance. Those checks must be performed separately on the
finished artifacts; raw-stub checks alone do not prove installer security.
