import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { test } from 'node:test'

const app = path.resolve(import.meta.dirname, '..')

function checkSigning(identity, check, variant) {
  const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }
  delete env.CSC_NAME
  delete env.HERMES_DESKTOP_VARIANT
  if (identity) env.CSC_NAME = identity
  if (variant) env.HERMES_DESKTOP_VARIANT = variant
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict'
    import path from 'node:path'
    import { getConfig, validateConfiguration } from 'app-builder-lib/internal'
    const config = await getConfig(process.cwd(), 'electron-builder.config.cjs', {
      extraMetadata: { version: '0.22.5' }
    })
    await validateConfiguration(config, { isEnabled: false })
    ${check}
  `], { cwd: app, env, encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, result.stdout + result.stderr)
}

test('fork ad-hoc signing uses the v27 schema and preserves the native signing policy', () => {
  checkSigning('-', `
    assert.equal(typeof config.mac.sign, 'object')
    assert.equal(config.mac.sign.identity, '-')
    assert.equal(config.mac.sign.hardenedRuntime, true)
    assert.equal(config.mac.sign.entitlements, path.join(process.cwd(), 'electron/entitlements.mac.plist'))
    assert.equal(config.mac.sign.entitlementsInherit, path.join(process.cwd(), 'electron/entitlements.mac.inherit.plist'))
    assert.equal(typeof config.mac.sign.ignore, 'function')
    assert.equal(config.mac.sign.ignore(process.cwd()), false)
    assert.equal(config.mac.sign.ignore(path.join(process.cwd(), 'package.json')), true)
  `)
})

test('certificate builds retain the custom payload signing hook', () => {
  checkSigning(undefined, `assert.equal(typeof config.mac.sign, 'function')`)
  checkSigning('-', `assert.equal(typeof config.mac.sign, 'function')`, 'bundled')
})
