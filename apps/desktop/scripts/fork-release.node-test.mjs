import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { resolveForkSource, verifyForkPackage } from './fork-release.mjs'

test('manual and push sources retain their actual identity and reject an unrelated baseline', () => {
  const repo = mkdtempSync(join(tmpdir(), 'fork-source-'))
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  try {
    git('init', '-b', 'custom/home')
    git('-c', 'user.name=Fork Test', '-c', 'user.email=fork@example.invalid', 'commit', '--allow-empty', '-m', 'official baseline')
    const upstreamCommit = git('rev-parse', 'HEAD')
    git('-c', 'user.name=Fork Test', '-c', 'user.email=fork@example.invalid', 'commit', '--allow-empty', '-m', 'fork customization')
    const commit = git('rev-parse', 'HEAD')
    const release = { upstreamCommit, version: '0.22.4' }
    git('update-ref', 'refs/remotes/origin/custom/home', upstreamCommit)
    assert.throws(() => resolveForkSource(repo, { EVENT_NAME: 'workflow_dispatch' }, release), /reachable from its origin branch/)
    git('update-ref', 'refs/remotes/origin/custom/home', commit)
    const source = resolveForkSource(repo, { EVENT_NAME: 'workflow_dispatch' }, release)
    assert.equal(source.commit, commit)
    assert.equal(source.branch, 'custom/home')
    assert.ok(source.release_tag.includes(commit.slice(0, 12)))
    assert.deepEqual(JSON.parse(source.matrix).include.map(item => item.platform), ['mac', 'windows'])
    git('update-ref', 'refs/remotes/origin/custom/ditt', commit)
    git('checkout', '-b', 'custom/ditt')
    assert.equal(resolveForkSource(repo, { EVENT_NAME: 'workflow_dispatch' }, release).bootstrap_branch, 'custom/ditt')
    git('update-ref', '-d', 'refs/remotes/origin/custom/home')
    git('tag', 'ditt-release', commit)
    git('checkout', 'ditt-release')
    assert.equal(resolveForkSource(repo, { EVENT_NAME: 'workflow_dispatch' }, release).branch, '')
    git('checkout', '--detach', commit)
    const detached = resolveForkSource(repo, { EVENT_NAME: 'workflow_dispatch' }, release)
    assert.equal(detached.branch, '')
    assert.equal(detached.bootstrap_branch, 'custom/ditt')
    git('update-ref', 'refs/remotes/origin/custom/home', commit)
    assert.equal(resolveForkSource(repo, { EVENT_NAME: 'push', EVENT_SHA: commit, EVENT_BRANCH: 'custom/home' }, release).branch, 'custom/home')
    assert.throws(() => resolveForkSource(repo, { EVENT_NAME: 'push', EVENT_SHA: upstreamCommit, EVENT_BRANCH: 'main' }, release), /triggering commit/)
    assert.throws(() => resolveForkSource(repo, {}, { ...release, upstreamCommit: 'a'.repeat(40) }))
    assert.throws(() => resolveForkSource(repo, {}, { ...release, version: '0.0.0' }), /real release version/)
    git('update-ref', '-d', 'refs/remotes/origin/custom/home')
    git('update-ref', '-d', 'refs/remotes/origin/custom/ditt')
    assert.throws(() => resolveForkSource(repo, {}, release), /no containing branch/)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('receipts bind both Windows artifacts to the selected clean source and reject wrong metadata', () => {
  const root = mkdtempSync(join(tmpdir(), 'fork-package-'))
  const resources = join(root, 'resources')
  mkdirSync(resources)
  const commit = 'b'.repeat(40)
  const stamp = { commit, branch: 'custom/home', source: 'ci', dirty: false,
    displayVersion: '0.22.4', payload: 'bootstrap', sourceRepository: 'T-wenhao/hermes-agent', sourceBranch: 'custom/home' }
  const args = { releaseDir: root, resources, platform: 'windows', commit, branch: 'custom/home', version: '0.22.4' }
  try {
    writeFileSync(join(resources, 'install-stamp.json'), JSON.stringify(stamp))
    writeFileSync(join(root, 'Hermes.msix'), 'unsigned package')
    writeFileSync(join(root, 'Hermes.zip'), 'portable app')
    const receipt = verifyForkPackage(args)
    assert.equal(receipt.installationVerified, false)
    assert.equal(receipt.artifacts.length, 2)
    assert.ok(receipt.artifacts.every(file => /^[a-f0-9]{64}$/.test(file.sha256)))
    for (const changed of [{ commit: 'c'.repeat(40) }, { dirty: true }, { displayVersion: '0.0.0' },
      { branch: 'main' }, { sourceBranch: 'main' }, { sourceRepository: 'NousResearch/hermes-agent' }]) {
      writeFileSync(join(resources, 'install-stamp.json'), JSON.stringify({ ...stamp, ...changed }))
      assert.throws(() => verifyForkPackage(args))
    }
    writeFileSync(join(resources, 'install-stamp.json'), JSON.stringify(stamp))
    rmSync(join(root, 'Hermes.msix'))
    assert.throws(() => verifyForkPackage(args), /one .msix artifact/)
    assert.equal(readFileSync(join(root, 'Hermes.zip'), 'utf8'), 'portable app')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
