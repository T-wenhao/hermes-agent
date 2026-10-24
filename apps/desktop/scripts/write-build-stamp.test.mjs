import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'vitest'

import {
  FALLBACK_BRANCH,
  FALLBACK_COMMIT,
  fromCI,
  fromFallback,
  fromLocalGit,
  isFallbackCommit,
  resolveStamp
} from './write-build-stamp.mjs'

test('fromCI reads GITHUB_SHA / GITHUB_REF_NAME', () => {
  assert.deepEqual(
    fromCI({ GITHUB_SHA: 'a'.repeat(40), GITHUB_REF_NAME: 'release' }),
    { commit: 'a'.repeat(40), branch: 'release', dirty: false, source: 'ci' }
  )
  assert.equal(fromCI({}), null)
})

test('fromLocalGit reads HEAD + branch + dirty status', () => {
  const calls = []
  const execFn = (argv) => {
    const cmd = argv.join(' ')
    calls.push(cmd)
    if (cmd === 'git rev-parse HEAD') return 'b'.repeat(40)
    if (cmd === 'git rev-parse --abbrev-ref HEAD') return 'main'
    if (cmd === 'git status --porcelain -uno') return ' M apps/desktop/package.json'
    return null
  }
  assert.deepEqual(fromLocalGit('/repo', execFn), {
    commit: 'b'.repeat(40),
    branch: 'main',
    dirty: true,
    source: 'local'
  })
  assert.ok(calls.includes('git rev-parse HEAD'))
})

test('fromFallback uses the all-zero placeholder commit', () => {
  assert.deepEqual(fromFallback(), {
    commit: FALLBACK_COMMIT,
    branch: FALLBACK_BRANCH,
    dirty: false,
    source: 'fallback'
  })
  assert.equal(isFallbackCommit(FALLBACK_COMMIT), true)
  assert.equal(isFallbackCommit('a'.repeat(40)), false)
})

test('resolveStamp uses CI when the checkout is unavailable and git for local builds', () => {
  const ci = resolveStamp({
    env: { GITHUB_SHA: 'c'.repeat(40), GITHUB_REF_NAME: 'main' },
    execFn: () => null
  })
  assert.equal(ci.source, 'ci')
  assert.equal(ci.commit, 'c'.repeat(40))

  const local = resolveStamp({
    env: {},
    execFn: (argv) => {
      const cmd = argv.join(' ')
      if (cmd === 'git rev-parse HEAD') return 'd'.repeat(40)
      if (cmd === 'git rev-parse --abbrev-ref HEAD') return 'main'
      if (cmd === 'git status --porcelain -uno') return ''
      return null
    }
  })
  assert.equal(local.source, 'local')
  assert.equal(local.commit, 'd'.repeat(40))
  assert.equal(local.dirty, false)
})

test('resolveStamp falls back when neither CI nor git is available', () => {
  const stamp = resolveStamp({ env: {}, execFn: () => null })
  assert.deepEqual(stamp, {
    commit: FALLBACK_COMMIT,
    branch: FALLBACK_BRANCH,
    dirty: false,
    source: 'fallback'
  })
})

test('CI stamp follows the checked-out source when a manual run selects another commit', () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'desktop-stamp-'))
  const git = (...args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim()
  try {
    git('init', '-b', 'main')
    writeFileSync(join(repoRoot, 'source.txt'), 'selected source')
    git('add', 'source.txt')
    git('-c', 'user.name=Desktop Test', '-c', 'user.email=desktop-test@example.invalid', 'commit', '-m', 'source')
    const selected = git('rev-parse', 'HEAD')
    git('checkout', '--detach', selected)
    const stamp = resolveStamp({ repoRoot, env: { GITHUB_SHA: 'f'.repeat(40), GITHUB_REF_NAME: 'main' } })
    assert.equal(stamp.commit, selected, 'The package must identify its source, not the workflow trigger')
    assert.equal(stamp.branch, null, 'A different workflow branch does not own the selected source')
    assert.equal(stamp.source, 'ci')
  } finally {
    rmSync(repoRoot, { recursive: true, force: true })
  }
})

test('a detached CI checkout keeps its branch hint only when the event commit matches', () => {
  const commit = 'e'.repeat(40)
  const stamp = resolveStamp({
    env: { GITHUB_SHA: commit, GITHUB_REF_NAME: 'custom/home' },
    execFn: argv => argv.join(' ') === 'git rev-parse HEAD' ? commit : argv.join(' ') === 'git rev-parse --abbrev-ref HEAD' ? 'HEAD' : ' M package.json'
  })
  assert.equal(stamp.branch, 'custom/home')
  assert.equal(stamp.dirty, true, 'CI packaging must not conceal modified tracked files')
})

test('explicit commit and channel identities never fall back to ordinary CI metadata', () => {
  const commit = 'a'.repeat(40)
  const execFn = argv => argv.join(' ') === 'git rev-parse HEAD' ? 'b'.repeat(40) : ''
  assert.throws(() => resolveStamp({ env: { GITHUB_SHA: commit, HERMES_BUILD_COMMIT: commit }, execFn }), /checkout HEAD/)
  assert.throws(() => resolveStamp({ env: { HERMES_BUILD_COMMIT: commit, HERMES_PAYLOAD_TAG: 'v0.22.4' }, execFn }), /without a release tag/)
  assert.throws(() => resolveStamp({ env: { _HERMES_CHANNEL_REQUEST_JSON: '{}', HERMES_DESKTOP_VARIANT: 'bundled', HERMES_BUILD_COMMIT: commit }, execFn }), /Channel request conflicts/)
})
// ── buildStampPayload — the staged-desktop full schema ─────────────────────

import { buildStampPayload } from './write-build-stamp.mjs'

const baseStamp = {
  commit: 'c'.repeat(40),
  branch: 'main',
  builtAt: '2026-08-14T00:00:00Z',
  dirty: false,
  source: 'ci'
}

const runtime = {
  repoDir: 'app', toolsDir: 'tools', storePython: 'tools/python/bin/python3',
  sitePackages: 'venv/lib/python3.14/site-packages', commands: { hermes: 'bin/hermes' }
}

test('bundled stamp carries the builder contract and refuses an unstaged payload', () => {
  const env = { HERMES_DESKTOP_VARIANT: 'bundled' }
  assert.throws(() => buildStampPayload(baseStamp, env, 'darwin'), /payload/)
  assert.deepEqual(buildStampPayload(baseStamp, env, 'darwin', { runtime }).runtime, runtime)
  assert.equal(buildStampPayload(baseStamp, { HERMES_DESKTOP_VARIANT: 'light' }, 'darwin', { runtime }).runtime, undefined)
})

test('source builds declare the same artifact schema, without a payload', () => {
  const stamp = buildStampPayload(baseStamp, {})
  assert.equal(stamp.payload, 'bootstrap')
  assert.equal(stamp.distribution, 'desktop-app')
  assert.equal(stamp.runtime, undefined)
  assert.equal(stamp.tag, null)
  assert.equal(stamp.commit, baseStamp.commit)
  const fork = buildStampPayload(baseStamp, { HERMES_BUILD_SOURCE_REPOSITORY: 'T-wenhao/hermes-agent', HERMES_BUILD_SOURCE_BRANCH: 'custom/ditt' })
  assert.equal(fork.sourceRepository, 'T-wenhao/hermes-agent')
  assert.equal(fork.sourceBranch, 'custom/ditt')
  assert.equal(stamp.sourceRepository, undefined, 'Official builds retain their default source')
  assert.throws(() => buildStampPayload(baseStamp, { HERMES_BUILD_SOURCE_REPOSITORY: 'untrusted/repository' }), /Untrusted/)
})

test('buildStampPayload keeps schemaVersion + provenance in the staged shape', () => {
  const payload = buildStampPayload(baseStamp, {
    HERMES_DESKTOP_VARIANT: 'bundled'
  }, 'win32', { runtime })
  assert.equal(payload.schemaVersion, 1)
  assert.equal(payload.commit, baseStamp.commit)
  assert.equal(payload.source, 'ci')
  assert.equal(payload.tag, null)
})

test('commit builds retain exact provenance without entering an update channel', () => {
  for (const platform of ['win32', 'darwin']) {
    const env = { HERMES_DESKTOP_VARIANT: 'bundled', HERMES_BUILD_COMMIT: baseStamp.commit }
    const payload = buildStampPayload(baseStamp, env, platform, { runtime })
    assert.equal(payload.commit, baseStamp.commit)
    assert.equal(payload.source, 'commit-build')
    assert.equal(payload.branch, null)
    assert.equal(payload.tag, null)
    assert.equal(payload.updateMechanism, 'external')
    assert.throws(() => buildStampPayload(baseStamp, { ...env, HERMES_BUILD_COMMIT: 'a'.repeat(40) }, platform, { runtime }), /commit/i)
    assert.throws(() => buildStampPayload(baseStamp, { ...env, HERMES_PAYLOAD_TAG: 'v1.2.3' }, platform, { runtime }), /tag/i)
  }
})
