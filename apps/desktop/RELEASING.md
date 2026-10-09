# Fork Desktop releases

`Release Desktop Clients` builds this fork's installers on GitHub Actions.

- A push to `custom/home` automatically builds a macOS arm64 DMG.
- Manual runs can select a source branch, tag or commit and `mac`, `windows`, or `both`.
- The source is resolved to one commit before the platform builds start.
- Releases use `desktop-<branch>-v<app-version>-<source-sha>` tags by default. The app version comes from `apps/desktop/package.json`; it is independent of the Python backend version.
- Each release includes the installer and a `desktop-<platform>-build.json` receipt with the actual source commit, branch, app version and run URL.

For example, run a Mac build of the current Home source:

```sh
gh workflow run release-desktop.yml --ref main -f ref=custom/home -f platforms=mac
```

`--ref main` selects the workflow definition. The `ref` input selects the application source. For a Windows build of the company branch, use `-f ref=custom/ditt -f platforms=windows`.

The workflow checks the approval protocol, packages the client, verifies its embedded source metadata, and publishes a pre-release. macOS bundles are ad-hoc signed; Apple Developer ID signing and notarization are not configured. GitHub packaging does not install the new app on a user's computer; download the DMG from Releases and install it.

The workflow file must exist on `custom/home` for push events to trigger. Its GitHub Actions state must also be active:

```sh
gh workflow view release-desktop.yml
gh workflow enable release-desktop.yml
```

To reproduce an older build, dispatch its exact source commit. An explicit `release_tag` may be supplied, but an existing release is reused only when it targets that same commit. The old `v2026.9.14` release is retained as historical output.
