import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { isMain } from './utils.mjs'

const defaultRelease = JSON.parse(readFileSync(new URL('../fork-release.json', import.meta.url), 'utf8'))
const fullSha = /^[a-f0-9]{40}$/

export function resolveForkSource(repo, env = process.env, release = defaultRelease) {
  assert.match(release.version, /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/)
  assert.notEqual(release.version, '0.0.0', 'Fork builds need a real release version')
  assert.match(release.upstreamCommit, fullSha)
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const commit = git('rev-parse', 'HEAD')
  assert.match(commit, fullSha)
  // The controller's version applies only to sources containing its official baseline.
  git('merge-base', '--is-ancestor', release.upstreamCommit, commit)
  let branch = git('rev-parse', '--abbrev-ref', 'HEAD')
  if (branch === 'HEAD') branch = ''
  if (env.EVENT_NAME === 'push') {
    assert.equal(commit, env.EVENT_SHA, 'Push source must match the triggering commit')
    branch = env.EVENT_BRANCH
  }
  assert.ok(!/[\r\n]/.test(branch), 'Invalid source branch')
  const tag = env.REQUESTED_TAG || `desktop-${branch.replaceAll('/', '-') || 'manual'}-v${release.version}-${commit.slice(0, 12)}`
  assert.match(tag, /^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Invalid release tag')
  const selections = {
    mac: [{ os: 'macos-latest', platform: 'mac' }],
    windows: [{ os: 'windows-latest', platform: 'windows' }]
  }
  const platforms = env.PLATFORMS || 'both'
  const include = platforms === 'both' ? [...selections.mac, ...selections.windows] : selections[platforms]
  assert.ok(include, 'Invalid installer platform')
  return { commit, branch, version: release.version, release_tag: tag, matrix: JSON.stringify({ include }) }
}

export function verifyForkPackage({ releaseDir, resources, platform, commit, branch = '', version, run = '' }) {
  assert.ok(platform === 'mac' || platform === 'windows', 'Unknown installer platform')
  const stamp = JSON.parse(readFileSync(join(resources, 'install-stamp.json'), 'utf8'))
  assert.equal(stamp.commit, commit, 'Package must identify the selected source')
  assert.equal(stamp.branch ?? '', branch, 'Package must identify the selected branch')
  assert.equal(stamp.source, 'ci')
  assert.equal(stamp.dirty, false, 'Published source must be clean')
  assert.equal(stamp.displayVersion, version, 'Package stamp must carry the injected version')
  assert.equal(stamp.payload, 'bootstrap', 'Fork workflow packages the source client without a bundled runtime')
  const formats = platform === 'mac' ? ['.dmg'] : ['.msix', '.zip']
  const files = readdirSync(releaseDir)
  const artifacts = formats.map(extension => {
    const matches = files.filter(file => file.endsWith(extension))
    assert.equal(matches.length, 1, `Expected one ${extension} artifact`)
    const file = matches[0]
    const path = join(releaseDir, file)
    assert.ok(statSync(path).size > 0, `Empty artifact: ${file}`)
    return { file, bytes: statSync(path).size, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }
  })
  return { ...stamp, version, platform, run, artifacts, installationVerified: false,
    signing: platform === 'mac' ? 'ad-hoc; not notarized' : 'unsigned; portable ZIP included' }
}

if (isMain(import.meta.url)) {
  const [mode, root = '.'] = process.argv.slice(2)
  if (mode === 'source') {
    const source = resolveForkSource(resolve(root))
    for (const [key, value] of Object.entries(source)) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`)
  } else if (mode === 'receipt') {
    const { PLATFORM, SOURCE_COMMIT, SOURCE_BRANCH, SOURCE_VERSION } = process.env
    const app = join(resolve(root), 'apps/desktop')
    const releaseDir = join(app, 'release')
    const resources = PLATFORM === 'mac'
      ? join(releaseDir, 'mac-arm64/Hermes.app/Contents/Resources')
      : join(releaseDir, 'win-unpacked/resources')
    const run = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    const receipt = verifyForkPackage({ releaseDir, resources, platform: PLATFORM,
      commit: SOURCE_COMMIT, branch: SOURCE_BRANCH, version: SOURCE_VERSION, run })
    writeFileSync(join(releaseDir, `desktop-${PLATFORM}-build.json`), JSON.stringify(receipt, null, 2) + '\n')
  } else {
    throw new Error(`Unknown fork release command: ${mode}`)
  }
}
