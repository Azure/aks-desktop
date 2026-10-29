# Verifying release downloads

AKS desktop releases can include:

- `checksums.txt`: SHA-256 digests of every attached asset except this manifest
  and its signature.
- `checksums.txt.sigstore.json`: a Sigstore keyless signature bundle for the
  manifest.

These attachments are produced by the **Sign release checksums** workflow.
They supplement, rather than replace, Windows code signing and macOS signing
and notarization. Releases without these attachments cannot be verified using
the commands below.

## Verify a download

Download your installer or archive, `checksums.txt`, and
`checksums.txt.sigstore.json` from the same
[GitHub release](https://github.com/Azure/aks-desktop/releases).

First authenticate the manifest with
[cosign](https://docs.sigstore.dev/cosign/system_config/installation/) v2.6.3
or newer:

```sh
cosign verify-blob checksums.txt \
  --bundle checksums.txt.sigstore.json \
  --certificate-identity 'https://github.com/Azure/aks-desktop/.github/workflows/sign-release.yml@refs/heads/main' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

Only continue if signature verification succeeds. On Linux, check the downloaded
file against the authenticated manifest:

```sh
sha256sum --check --ignore-missing checksums.txt
```

On macOS:

```sh
shasum -a 256 --check --ignore-missing checksums.txt
```

On Windows, replace the example name with the installer you downloaded:

```powershell
$file = 'aks-desktop-0.10.0-win-x64.exe'
$entries = @(Get-Content checksums.txt | Where-Object { $_.EndsWith("  $file") })
if ($entries.Count -ne 1) { throw 'Expected exactly one checksum for the installer' }
$expected = $entries[0].Substring(0, 64)
if ((Get-FileHash -Algorithm SHA256 $file).Hash -ne $expected) {
  throw 'Installer checksum does not match'
}
Write-Output 'Checksum verified'
```

Check that your downloaded file is explicitly reported as verified. Missing
files ignored by the Unix commands are not verified.

## Maintainer release handoff

1. Build the production artifacts using the Azure/1ES release pipelines.
   Finish native signing and notarization before copying any artifacts.
2. Attach the final installers and archives to the intended GitHub release
   draft, using its planned release tag. The Git tag does not need to exist
   yet: the workflow discovers the draft through the releases list and checks
   it by release ID. The workflow does not download Azure pipeline artifacts,
   build installers, or replace payloads.
3. Run **Sign release checksums** from `main`, supplying that release tag.
   Keep **Allow retrospective signing of a published release** disabled for
   normal releases.
4. Require the workflow to succeed before publishing the draft. It downloads
   and hashes every payload, signs and verifies the manifest, replaces the
   signing attachments, and downloads them again to check their exact bytes.
   It also checks that the release and payload asset identities have not
   changed while it was running.
5. Publish the release manually. The workflow does not change its draft status.

Signing jobs for the same tag are serialized. Do not edit release assets or
publish the draft while signing is running. Asset names must use letters,
digits, `.`, `_`, `+`, or `-`, and must begin with a letter or digit.
Incomplete or empty payload uploads are rejected.

After adding or replacing a payload, rerun the workflow to replace both
metadata files. An error fails the job; the workflow reconciles attempted
uploads against the release asset list, including empty assets GitHub may
create before returning an upload error. New signing attachments are removed
where possible, and reconciliation or cleanup errors are reported explicitly. A failed
replacement can leave the release without signing metadata. Correct the
underlying problem and rerun before publishing or advertising verification.

### Existing mutable published releases

Maintainers can explicitly enable retrospective signing for an existing
mutable published release. Review its assets first, and do not replace the installers
just to add metadata. The workflow leaves the release published, but its
metadata can be briefly unavailable during replacement.

Immutable published releases cannot accept new or replacement assets. Sign
and verify their checksums while they are still drafts, before publication
makes them immutable. Retrospective signing cannot backfill such releases.

This authenticates the bytes attached **at the time of signing**. It does not
establish that those bytes are identical to the original historical release
or prove which source revision and build produced them. This workflow does
not generate SLSA build provenance; that requires integration with the actual
production builders.

### OpenSSF Scorecard expectations

The [Signed-Releases check](https://github.com/ossf/scorecard/blob/c22063e786c11f9dd714d777a687ff7c4599b600/checks/evaluation/signed_releases.go#L108-L155)
scores the last five eligible releases, averaging their individual scores and
rounding down. Signatures alone contribute 8/10 per release; recognized build
provenance contributes 10/10. With five eligible releases and no other signatures
or provenance, signing only one yields 1/10 overall, not 8/10. Signing all five
can reach 8/10; this signing-only workflow does not provide the build provenance
needed for 10/10. Historical unsigned releases remain in the rolling window
until they are signed (if mutable) or replaced in the window by newer releases.

## Fork validation and tests

The script uses `GITHUB_REPOSITORY`, not a hardcoded upstream repository.
A fork run signs with the fork's workflow identity, which must not be accepted
as the identity of an Azure release. Do not weaken the verification identity
above to accept arbitrary forks or branches.

Run the dependency-free publisher tests with:

```sh
npm run test:release-signing
```

They exercise real hashing and temporary files while substituting the external
GitHub API and cosign process. A real GitHub Actions run is still needed to
validate OIDC permissions and cryptographic signing end to end.
