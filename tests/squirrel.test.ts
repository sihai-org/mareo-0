import assert from 'node:assert/strict'
import test from 'node:test'
import { squirrelActionFor } from '../src/squirrel.js'

test('maps Squirrel lifecycle arguments to actions on Windows', () => {
  assert.equal(squirrelActionFor(['Mareo.exe', '--squirrel-install'], 'win32'), 'create-shortcuts')
  assert.equal(squirrelActionFor(['Mareo.exe', '--squirrel-updated'], 'win32'), 'create-shortcuts')
  assert.equal(squirrelActionFor(['Mareo.exe', '--squirrel-uninstall'], 'win32'), 'remove-shortcuts')
  assert.equal(squirrelActionFor(['Mareo.exe', '--squirrel-obsolete'], 'win32'), 'quit')
})

test('ignores unrelated arguments and other platforms', () => {
  assert.equal(squirrelActionFor(['Mareo.exe'], 'win32'), undefined)
  assert.equal(squirrelActionFor(['Mareo.exe', '--no-sandbox'], 'win32'), undefined)
  assert.equal(squirrelActionFor(['Mareo.exe', '--squirrel-install'], 'darwin'), undefined)
  assert.equal(squirrelActionFor([], 'win32'), undefined)
})
