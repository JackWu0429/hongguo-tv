const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const wheel = require('../core/cmd/hongguotv/ui/episode-wheel.js');

function fixture(options = {}) {
  const listeners = {};
  const surface = {
    addEventListener(name, listener) { listeners[name] = listener; },
    removeEventListener(name) { delete listeners[name]; }
  };
  const steps = [];
  const detach = wheel.attach(surface, {
    isEnabled: options.isEnabled || (() => true),
    onStep(step) { steps.push(step); }
  });
  function send({ at, deltaY, deltaX = 0, deltaMode = 0, target = surface, ctrlKey = false }) {
    let prevented = false;
    listeners.wheel({ timeStamp: at, deltaY, deltaX, deltaMode, target, ctrlKey, defaultPrevented: false,
      preventDefault() { prevented = true; } });
    return prevented;
  }
  return { surface, steps, send, detach, listeners };
}

function node(tagName, attributes = {}, parentElement = null) {
  return {
    tagName,
    parentElement,
    className: attributes.className || '',
    isContentEditable: !!attributes.isContentEditable,
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null; }
  };
}

test('desktop player wheel coalesces small trackpad deltas into one episode switch', () => {
  const f = fixture();
  for (let i = 0; i < 9; i++) f.send({ at: i * 35, deltaY: 9 });
  assert.deepEqual(f.steps, [1]);
});

test('long trackpad inertia cannot trigger repeated episode switches', () => {
  const f = fixture();
  for (let i = 0; i < 36; i++) f.send({ at: i * 45, deltaY: 8 });
  assert.deepEqual(f.steps, [1]);
});

test('direction reversal resets the accumulated trackpad distance', () => {
  const f = fixture();
  f.send({ at: 0, deltaY: 25 });
  f.send({ at: 40, deltaY: -32 });
  f.send({ at: 80, deltaY: -31 });
  assert.deepEqual(f.steps, [-1]);
});

test('one-line and three-line mouse notches both switch once', () => {
  const oneLine = fixture();
  oneLine.send({ at: 0, deltaY: 1, deltaMode: 1 });
  assert.deepEqual(oneLine.steps, [1]);

  const threeLines = fixture();
  threeLines.send({ at: 0, deltaY: 3, deltaMode: 1 });
  assert.deepEqual(threeLines.steps, [1]);
});

test('pixel-mode mouse wheel crosses threshold and reverses episode direction', () => {
  const f = fixture();
  f.send({ at: 0, deltaY: 100 });
  f.send({ at: 900, deltaY: -100 });
  assert.deepEqual(f.steps, [1, -1]);
});

test('rapid second gesture is suppressed by cooldown, later gesture is accepted', () => {
  const f = fixture();
  f.send({ at: 0, deltaY: 3, deltaMode: 1 });
  f.send({ at: 400, deltaY: 3, deltaMode: 1 });
  f.send({ at: 900, deltaY: 3, deltaMode: 1 });
  assert.deepEqual(f.steps, [1, 1]);
});

test('wheel over dialogs, buttons, inputs, textareas and contenteditable passes through', () => {
  const f = fixture();
  const dialog = node('DIV', { role: 'dialog' }, f.surface);
  const targets = [
    node('BUTTON', {}, f.surface),
    node('INPUT', {}, f.surface),
    node('TEXTAREA', {}, f.surface),
    node('SELECT', {}, f.surface),
    node('A', {}, f.surface),
    node('DIV', {}, dialog),
    node('DIV', { isContentEditable: true }, f.surface),
    node('DIV', { className: 'player-options' }, f.surface)
  ];
  targets.forEach((target, index) => {
    assert.equal(f.send({ at: index * 50, deltaY: 120, target }), false);
  });
  assert.deepEqual(f.steps, []);
});

test('disabled routes, horizontal scrolling and browser zoom are not intercepted', () => {
  const f = fixture({ isEnabled: () => false });
  assert.equal(f.send({ at: 0, deltaY: 120 }), false);
  assert.equal(f.send({ at: 20, deltaY: 4, deltaX: 12 }), false);
  assert.equal(f.send({ at: 40, deltaY: 120, ctrlKey: true }), false);
  assert.deepEqual(f.steps, []);
});

test('wheel listener can be detached cleanly', () => {
  const f = fixture();
  f.detach();
  assert.equal(f.listeners.wheel, undefined);
});

test('application wires wheel only to desktop single-player playback and reuses episode switching', () => {
  const app = fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/app.js'), 'utf8');
  const html = fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/index.html'), 'utf8');
  assert.match(html, /<script src="\/episode-wheel\.js"><\/script>/);
  assert.match(app, /if \(desktopShell && window\.HongguoEpisodeWheel\)[\s\S]*?pageMode\(\) === 'player'[\s\S]*?onStep: function \(step\) \{ switchPlayerEpisode\(step, true\); \}/);
  assert.match(app, /var accountCountryModalOpen\s*=/);
  assert.match(app, /!accountCountryModalOpen/);
  assert.doesNotMatch(app, /!accountCountryOpen\b/);
  assert.match(app, /function switchPlayerEpisode\(step, fromWheel\)[\s\S]*?!fromWheel && zoneOf\(document\.activeElement\) !== 'feed'/);
});
