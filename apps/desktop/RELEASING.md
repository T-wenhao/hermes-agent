# Fork Desktop releases

`Release Desktop Clients` builds this fork's installers on GitHub Actions.

- A push to `custom/home` automatically builds a macOS arm64 DMG and Windows x64 MSIX plus a portable ZIP.
- Manual runs default to both platforms. `source_ref` selects an upgraded Home/DITT branch, tag or commit; `platforms` selects `mac`, `windows`, or `both`.
- The source is resolved to one commit before the platform builds start.
- Releases use `desktop-<branch>-v<version>-<source-sha>` tags by default. `fork-release.json` pins version `0.22.5` and its official source commit; the workflow rejects sources that do not contain that baseline. Update this file when adopting a later official release. Upstream's `package.json` version is a placeholder and must not be used for these releases.
- The version is injected into package metadata and the install stamp. Each release includes `desktop-<platform>-build.json` with the source commit, branch, version, artifact SHA256 hashes and run URL.
- Controller scripts come from the immutable workflow revision in a separate checkout. The selected source needs no Home-specific release files, so `source_ref=custom/ditt` works after that branch is upgraded to the pinned baseline.

For example, run a Mac build of the current Home source:

```sh
gh workflow run release-desktop.yml --ref custom/home -f source_ref=custom/home -f platforms=mac
```

`--ref custom/home` selects the upgraded workflow definition; `source_ref` selects the application source. For a Windows build of the upgraded company branch, use `-f source_ref=custom/ditt -f platforms=windows`. A tag or exact SHA produces a detached source identity without borrowing the workflow's branch name.

The workflow checks the approval protocol and release helper contracts, packages the source client, verifies its source metadata, and publishes a pre-release. It does not bundle Python or a prepared Hermes runtime; first-launch backend setup can still require the network. Complete bundled distributions use the separate upstream process described in `BUILDING.md`.

macOS bundles use ad-hoc signing without Apple Developer ID or notarization. The upstream Electron 44 runtime requires macOS 13 or newer. Windows MSIX packages are unsigned and are not ordinary trusted installers; their manual installation depends on the machine's package trust/policy. The portable ZIP provides an alternative: extract the whole archive and launch `Hermes.exe`. The MSIX manifest requires Windows 11 22H2 or newer. The ZIP is a source client too.

The receipt explicitly records `installationVerified: false`. Packaging and metadata checks do not prove native installation, startup, backend connectivity, upgrade/data retention, Gatekeeper acceptance or Windows trust. Verify those on the destination machines before adopting a build. This workflow does not publish updater feeds, submit to the Store, or use private Apple/Azure/R2 credentials.

First-launch setup uses the baked `sourceRepository` allowlisted to this fork (or the official repository for official artifacts). Downloads and both installer clone operations use that same repository. Detached artifacts retain a separate `sourceBranch`, selected from an actual containing remote branch, so exact Home/DITT commits can pass the installer's existing ancestry check without being mislabeled as branch builds. A detached source with no containing branch is rejected. Both source branches must contain this runtime provenance support before they can produce a verified fork package.

The build prepares `HERMES_PYTHON` through the pinned PM Python toolchain. Native Mac DMG preparation then acquires PM's locked `dmgbuild` vendor tree with its paired interpreter; an ambient Python alone does not satisfy this supplier contract.

The workflow file must exist on `custom/home` for push events to trigger. Its GitHub Actions state must also be active:

```sh
gh workflow view release-desktop.yml
gh workflow enable release-desktop.yml
```

To reproduce an older build, dispatch its exact source commit. An explicit `release_tag` may be supplied, but an existing release is reused only when it targets that same commit. The old `v2026.9.14` release is retained as historical output.
