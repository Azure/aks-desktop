# Packaged keytar runtime

This directory provides the external `keytar` module used by `azure-api-bundle.js` on macOS. The loader selects a native binary using `process.platform` and `process.arch`, allowing one plugin package to support Intel and Apple Silicon Macs.

The native binaries are from the keytar 7.9.0 GitHub release:

- `darwin-x64`: `keytar-v7.9.0-napi-v3-darwin-x64.tar.gz`, SHA-256 `4ce56e3896e76a2deaef13f8a36207efa6d94d96678d30200952d83d327eb5f9`
- `darwin-arm64`: `keytar-v7.9.0-napi-v3-darwin-arm64.tar.gz`, SHA-256 `195f0855e26f83e0d61e228d1b61c7769baa993244518dc9879d9d57104c7cec`

Source: `https://github.com/atom/node-keytar/releases/tag/v7.9.0`

`npm run bin:build` runs `src-bin/download-keytar.mjs` before bundling. On every build host, it downloads both archives, verifies their SHA-256 values, and extracts each archive's `build/Release/keytar.node` into `bin/darwin-{arch}/keytar.node`. It also verifies the extracted binaries before writing them. Existing binaries are reused only when their checksums match.

The generated binaries remain gitignored and are copied into the plugin's `node_modules/keytar` directory by `headlamp.extraDist`. No host-specific native build is required. The download step requires Node.js 18 or newer, `tar` on PATH, and network access unless both verified binaries are already present.

The extracted binary SHA-256 values are:

- `darwin-x64/keytar.node`: `62a94162e3108f55f287764ebcdec0c735988487b79f45da4172826f0decbc96`
- `darwin-arm64/keytar.node`: `6c32c41c0e5a9e546616607b0383eada5bb646d0164324f20baab59d5b7963fa`

Run `npm run test:bin` to test installation, cache reuse, and checksum validation without network access.
