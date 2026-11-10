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
