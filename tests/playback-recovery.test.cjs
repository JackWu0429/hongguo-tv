const {test} = require('node:test');
const assert = require('node:assert/strict');
const {create} = require('../core/cmd/hongguotv/ui/playback-recovery.js');

test('refreshes a failed non-MPV source once and then stops', () => {
  const recovery = create({maxAttempts: 1});
  assert.equal(recovery.next({native: ''}), 'refresh');
  assert.equal(recovery.attempts(), 1);
  assert.equal(recovery.next({native: ''}), 'stop');
});

test('never automatically rebuilds an MPV session', () => {
  const recovery = create({maxAttempts: 1});
  assert.equal(recovery.next({native: 'mpv'}), 'stop');
  assert.equal(recovery.attempts(), 0);
});

test('reset starts a new bounded recovery window', () => {
  const recovery = create({maxAttempts: 1});
  assert.equal(recovery.next({}), 'refresh');
  recovery.reset();
  assert.equal(recovery.next({}), 'refresh');
});
