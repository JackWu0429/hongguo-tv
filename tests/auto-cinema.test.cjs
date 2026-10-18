const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create, shouldEnter, supports } = require('../core/cmd/hongguotv/ui/auto-cinema.js');

function storage(initial) {
  const values = Object.assign({}, initial);
  return {
    getItem(key) { return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null; },
    setItem(key, value) { values[key] = String(value); },
    values
  };
}

test('auto cinema is supported only on Android and webOS', () => {
  assert.equal(supports('android'), true);
  assert.equal(supports('webos'), true);
  assert.equal(supports('desktop'), false);
  assert.equal(shouldEnter({ platform: 'android', enabled: true, page: 'recommend', initialCardLaunch: true, firstFrame: true, focusedOnPlayer: true }), false);
  assert.equal(shouldEnter({ platform: 'desktop', enabled: true, page: 'player', initialCardLaunch: true, firstFrame: true, focusedOnPlayer: true }), false);
});

test('Android auto cinema defaults on and persists through the native bridge', () => {
  let saved = null;
  const states = [];
  const bridge = {
    readAutoCinema() { return saved; },
    writeAutoCinema(value) { saved = value; }
  };
  const controller = create({ platform: 'android', bridge, storage: storage(), render: state => states.push(state) });
  assert.equal(controller.enabled(), true);
  assert.equal(states[0].supported, true);
  assert.equal(controller.choose('disabled'), true);
  assert.equal(saved, 'disabled');
  assert.equal(controller.enabled(), false);
  assert.equal(controller.choose('enabled'), true);
  assert.equal(saved, 'enabled');
});

test('webOS uses local storage and desktop remains hidden', () => {
  const store = storage({ 'hongguo-tv-auto-cinema': 'disabled' });
  const webos = create({ platform: 'webos', storage: store });
  assert.equal(webos.enabled(), false);
  assert.equal(webos.choose('enabled'), true);
  assert.equal(store.values['hongguo-tv-auto-cinema'], 'enabled');

  const desktopStates = [];
  const desktop = create({ platform: 'desktop', storage: store, render: state => desktopStates.push(state) });
  assert.equal(desktopStates[0].supported, false);
  assert.equal(desktop.enabled(), false);
  assert.equal(desktop.choose('enabled'), false);
});

test('only a focused first frame from a card player launch enters cinema mode', () => {
  const base = { platform: 'android', enabled: true, page: 'player', initialCardLaunch: true, firstFrame: true, focusedOnPlayer: true, userExited: false };
  assert.equal(shouldEnter(base), true);
  assert.equal(shouldEnter(Object.assign({}, base, { firstFrame: false })), false);
  assert.equal(shouldEnter(Object.assign({}, base, { focusedOnPlayer: false })), false);
  assert.equal(shouldEnter(Object.assign({}, base, { userExited: true })), false);
});
