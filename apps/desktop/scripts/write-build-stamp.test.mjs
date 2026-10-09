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
  const execFn = (cmd) => {
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
    execFn: (cmd) => {
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
    execFn: cmd => cmd === 'git rev-parse HEAD' ? commit : cmd === 'git rev-parse --abbrev-ref HEAD' ? 'HEAD' : ' M package.json'
  })
  assert.equal(stamp.branch, 'custom/home')
  assert.equal(stamp.dirty, true, 'CI packaging must not conceal modified tracked files')
})
