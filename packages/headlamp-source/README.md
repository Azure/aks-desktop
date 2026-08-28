# Headlamp source package

`@headlamp-k8s/headlamp-source` materializes a pinned Headlamp revision, applies
the consumer repository's npm patch, bundles configured plugins, and generates
the product manifest used by desktop and container builds.

The consumer's root `package.json` configures the package with the
`headlampSource` and `headlamp` objects described below. See the repository's
[maintenance guide](../../MAINTENANCE.md) for the source update and patch rebase
workflow.

## `headlampSource`

`headlampSource` identifies the exact upstream source used to create the local
package.

| Field | Required | Description |
| --- | --- | --- |
| `repository` | Yes | Git repository URL from which the pinned commit is fetched. |
| `ref` | Yes | Human-readable upstream ref. Update tooling records it in package metadata; `commit` remains authoritative. |
| `commit` | Yes | Full Git commit SHA to fetch, verify, materialize, and include in build metadata. |
| `previousCommit` | Managed | Previous pinned commit retained automatically when `commit` changes. This records the baseline used to update and rebase the patch series. |
| `baseTag` | No | Optional release tag used as the package version baseline. Omit it for commit-only versioning. |

Changing `commit` also records its old value as `previousCommit` and requires
regenerating the package version, lockfile entry, patch selector, and patch
integrity. Without `baseTag`, package versions use `0.0.0-main.<sha8>`. With `baseTag`, they use
`<tag-version>-main.<sha8>`. Use the update workflow in
the [maintenance guide](../../MAINTENANCE.md#test-or-adopt-another-headlamp-commit)
rather than editing those generated values independently.

The root `headlampSourceTagsToo` object is an inactive example. To use tag-based
versioning later, copy its `baseTag` into `headlampSource`; scripts ignore
`headlampSourceTagsToo`.

### Script API

`scripts/update-source.ts` exports these typed functions:

| Function | Parameters | Returns |
| --- | --- | --- |
| `sourceVersion(config)` | `{ commit, baseTag? }` | Package version. Commit-only configuration returns `0.0.0-main.<sha8>`; an optional `vX.Y.Z` tag returns `X.Y.Z-main.<sha8>`. |
| `prepareHeadlampSource(options?)` | `{ rootDir?, packageDir?, sourceDir? }` | `{ packageDir, prepared }`. Materializes the configured commit and aggregate patch when needed. |
| `updateHeadlampSource(options)` | `{ sourceDir, rootDir?, packageDir?, commit?, baseTag? }` | `{ packageDir, patchPath, version }`. Updates source metadata, lockfile selection, and patch integrity. |

The CLI accepts `--source`, `--commit`, optional `--base-tag`, and `--root`.

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
| `capabilities` | No | Plugin capability policy copied to the generated product manifest, such as reviewed `runCommands`. |
| `source` | One source field | A repository-relative workspace path, or `{ "type": "package" }` for a prebuilt dependency under `node_modules`. Workspace plugins are installed and built before bundling. |
| `archive` | One source field | HTTPS URL handled by Headlamp's shipped-plugin installer. Requires `sha256`. |
| `file` | One source field | Local packaged-plugin input handled by Headlamp's shipped-plugin installer. Requires `sha256`. |
| `sha256` | For `archive` or `file` | A 64-character hexadecimal SHA-256 digest. |

Each plugin must declare exactly one of `source`, `archive`, or `file`.

## Example

```json
{
  "headlampSource": {
    "repository": "https://github.com/kubernetes-sigs/headlamp.git",
    "ref": "refs/heads/main",
    "commit": "<full-commit-sha>"
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