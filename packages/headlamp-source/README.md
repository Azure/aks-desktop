# Headlamp source package

`@headlamp-k8s/headlamp-source` materializes a pinned Headlamp revision, applies
the consumer repository's npm patch, bundles configured plugins, and generates
the product manifest used by desktop and container builds.

The consumer's root `package.json` configures the package with the
`headlampSource` and `headlamp` objects described below. See the repository's
[maintenance guide](../../MAINTENANCE.md) for the source update and patch rebase
workflow.

## `headlampSource`

`headlampSource` contains the exact Headlamp Git revision to build.

| Field | Required | Description |
| --- | --- | --- |
| `revision` | Yes | Full 40-character Git SHA to fetch, verify, materialize, and include in build metadata. |

`revision` is the only allowed field in `headlampSource`.

```json
{
  "headlampSource": {
    "revision": "69bfa236dab6c1c00658e11af1d21762d00c0700"
  }
}
```

The repository is fixed to `https://github.com/kubernetes-sigs/headlamp.git`.
Changing `revision` selects a different source tree and generates package version
`0.0.0-main.<sha8>`. Use the
[maintenance workflow](../../MAINTENANCE.md#update-the-headlamp-commit) instead
of editing generated package metadata, lockfile entries, or patches separately.

### Script API

`scripts/update-source.ts` exports these typed functions:

| Function | Parameters | Returns |
| --- | --- | --- |
| `sourceVersion(config)` | `{ revision }` | Package version in the form `0.0.0-main.<sha8>`. |
| `prepareHeadlampSource(options?)` | `{ rootDir?, packageDir?, sourceDir? }` | `{ packageDir, prepared }`. Materializes the configured commit and aggregate patch when needed. |
| `updateHeadlampSource(options)` | `{ sourceDir, rootDir?, packageDir?, revision? }` | `{ packageDir, patchPath, version }`. Updates source metadata, lockfile selection, and patch integrity. |

The CLI accepts `--source`, optional `--revision`, and `--root`.

### Install script policy

npm 12 blocks dependency lifecycle scripts unless the nearest project manifest
approves them. The patched Headlamp app approves only Electron because its
postinstall downloads the desktop runtime required by `npm start`. The app
lockfile omits registry `resolved` metadata, so npm cannot match a version-pinned
approval; package contracts instead require the declared Electron range to start
at the exact locked version. Other dependency install scripts remain blocked.

Local development starts the backend, frontend, and Electron client as separate
processes. Their scripts share the development-only backend token `headlamp` so
Electron tray requests and renderer requests authenticate to the external
backend. Packaged apps do not use that override and continue to generate a fresh
random token for their self-hosted backend.

## `headlamp`

`headlamp` describes the product manifest, packaged resources and tools, and
plugins. The package adds the root package version to `product.version` when it
generates the manifest. Consumer-only `build` data and plugin source fields are
not copied into the generated runtime manifest.

### Product fields

| Field | Required | Description |
| --- | --- | --- |
| `product.name` | Yes | Stable product identifier. |
| `product.productName` | Yes | User-visible product name. |
| `product.appId` | By desktop build | Application identifier used by Electron packaging. |
| `product.artifactName` | By desktop build | Artifact filename template. Electron builder substitutions such as `${version}`, `${os}`, `${arch}`, and `${ext}` are supported. |
| `product.protocols` | No | Protocol registration metadata. `name` is the display name and `schemes` lists handled URI schemes. |
| `checkForUpdates` | No | Whether the packaged application checks for updates. |
| `legalDocuments` | No | Legal document descriptors. Each entry has an `id`, display `title`, and packaged `file` name. |
| `platforms` | By desktop build | Per-platform packaging metadata. `linux`, `mac`, and `win` may define `executableName`; `mac` may also define `appId`. |

Additional product-manifest fields supported by Headlamp may be placed under
`headlamp`; they are copied to the generated manifest unless they are the
consumer-only `build` field.

### `build`

| Field | Required | Description |
| --- | --- | --- |
| `build.manifest` | Yes | Path to the generated product manifest, relative to the materialized Headlamp app directory. The path must remain inside that directory. |
| `build.frontendEnvironment` | No | Public `REACT_APP_*` string values written to the materialized frontend's `.env.local` before development or packaging builds. Never place secrets in this object. |
| `build.resources` | Yes | Resources copied into the application. Each entry has `base`, `from`, and `to`. |
| `build.resources[].base` | Yes | `headlampApp` resolves `from` from the Headlamp app directory; `project` resolves it from the consumer repository root. |
| `build.resources[].from` | Yes | Source path beneath the selected base directory. |
| `build.resources[].to` | Yes | Destination path in the packaged application. |
| `build.externalTools` | Yes | Tools included in the product manifest with generated SHA-256 verification data. |
| `build.externalTools[].id` | Yes | Stable tool identifier. |
| `build.externalTools[].platforms` | Yes | Platform records keyed by `linux`, `darwin`, or `win32`. The active build platform must have a record. |
| `build.externalTools[].platforms.<platform>.file` | Yes | Tool file relative to the materialized Headlamp app directory. |
| `build.externalTools[].platforms.<platform>.path` | Yes | Tool path in the packaged application. |
| `build.externalTools[].platforms.<platform>.verificationPath` | No | Packaged file to verify when it differs from `path`; defaults to `path`. |

### `plugins`

`headlamp.plugins` is required and must be an array. Bundle names and package
identities must be unique, including case-insensitive comparisons.

| Field | Required | Description |
| --- | --- | --- |
| `name` | Yes | Unscoped bundle directory name. It may contain letters, numbers, `.`, `_`, and `-`. |
| `packageName` | Yes | Exact npm package identity expected in the plugin's `package.json`. Scoped names are supported. |
| `enabledByDefault` | No | Boolean default written to the bundled plugin metadata. A saved user preference still takes precedence at runtime. |
| `source` | One source field | A repository-relative workspace path, or `{ "type": "package" }` for a prebuilt dependency under `node_modules`. Workspace plugins are installed and built before bundling. |
| `archive` | One source field | HTTPS URL handled by Headlamp's shipped-plugin installer. Requires `sha256`. |
| `file` | One source field | Local packaged-plugin input handled by Headlamp's shipped-plugin installer. Requires `sha256`. |
| `sha256` | For `archive` or `file` | A 64-character hexadecimal SHA-256 digest. |

Each plugin must declare exactly one of `source`, `archive`, or `file`.

### `runCommands`

Top-level `headlamp.runCommands` records the commands the product allows plugins
to run. It is separate from `headlamp.plugins`; the source package copies it
unchanged into the generated product manifest. Each policy selects one runtime
environment and plugin installation location, identifies one or more plugins,
and declares their command grants:

```json
{
  "environment": "production",
  "pluginLocation": "shipped",
  "plugins": [
    {
      "bundleName": "example-plugin",
      "packageName": "@example/plugin"
    }
  ],
  "commands": [
    {
      "tool": "examplectl",
      "args": ["project", "list"],
      "allowTrailingArgs": true
    }
  ]
}
```

`environment` is `development` or `production`. `pluginLocation` is
`development`, `user`, or `shipped`. Each plugin identity pairs its bundle
directory with its package name. In each command, `tool` is the executable
name, `args` is the required argument prefix, and `allowTrailingArgs` allows
arguments after that prefix. Use `tool`, not `command`.

Commands resolve from Headlamp's sanitized system `PATH` by default. A product
that intentionally runs a binary supplied by the plugin may add
`pluginExecutables` to the policy. Each entry must map a granted `tool` to the
exact path `bin/<tool>`. Headlamp does not fall back between plugin and system
origins, and production plugin executables require app-owned integrity receipts.
AKS Desktop omits `pluginExecutables` because its `az` and `kubectl` grants use
the bundled tools exposed through the sanitized system path.

Only the product may define command grants. A plugin's own `package.json` must
not declare `headlamp.runCommands`, because plugin-controlled grants would let
the plugin authorize itself. Headlamp validates the product policy and enforces
it in the Electron main process before starting a command.

## Example

```json
{
  "headlampSource": {
    "revision": "0123456789abcdef0123456789abcdef01234567"
  },
  "headlamp": {
    "product": {
      "name": "example-desktop",
      "productName": "Example Desktop",
      "appId": "com.example.desktop",
      "artifactName": "example-${version}-${os}-${arch}.${ext}"
    },
    "checkForUpdates": false,
    "build": {
      "manifest": ".example/product-manifest.json",
      "resources": [
        {
          "base": "project",
          "from": "LICENSE.txt",
          "to": "LICENSE.txt"
        }
      ],
      "externalTools": []
    },
    "plugins": [
      {
        "name": "example-plugin",
        "packageName": "@example/plugin",
        "source": "plugins/example-plugin",
        "enabledByDefault": true
      }
    ]
  }
}
```