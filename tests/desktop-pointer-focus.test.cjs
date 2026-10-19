const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPointerFocus } = require('../core/cmd/hongguotv/ui/desktop.js');

function fixture(pointerEvents = true) {
  const listeners = {}, windowListeners = {}, nodes = [], focused = [], hovered = [];
  const doc = { activeElement: null, addEventListener(name, fn) { listeners[name] = fn; } };
  const win = { document: doc, PointerEvent: pointerEvents, addEventListener(name, fn) { windowListeners[name] = fn; } };
  let controller, scope = '';
  function node(id, tagName = 'BUTTON', layer = '') {
    const classes = new Set();
    const item = { id, tagName, layer, classes, disabled: false,
      classList: { add: name => classes.add(name), remove: name => classes.delete(name) },
      closest() { return this; },
      focus(options) { focused.push({ id, options }); doc.activeElement = item; controller.focusChanged(item); }
    };
    nodes.push(item); return item;
  }
  const allowed = item => nodes.includes(item) && !item.disabled && item.layer === scope;
  controller = createPointerFocus(win, { selector: '[data-focus]', allowed,
    paint(item) { nodes.forEach(n => n.classes.delete('is-focused')); if (item) item.classes.add('is-focused'); },
    focus: item => item.focus(), hover: item => hovered.push(item && item.id) });
  let position = 0;
  function move(item, extra = {}) { listeners[pointerEvents ? 'pointermove' : 'mousemove']({ target: item, clientX: ++position, clientY: 20, pointerType: 'mouse', ...extra }); }
  function key(key, extra = {}) { listeners.keydown({ key, preventDefault() { assert.fail('mouse handoff consumed a key'); }, ...extra }); }
  function active(item) { doc.activeElement = item; controller.focusChanged(item); }
  return { doc, nodes, focused, hovered, node, allowed, controller, listeners, windowListeners, move, key, active,
    setScope(value) { scope = value; }, highlights: () => nodes.filter(n => n.classes.has('is-focused')).map(n => n.id) };
}

test('hover paints one shared highlight without focusing, clicking or scrolling a target', () => {
  const f = fixture(), original = f.node('original'), button = f.node('button');
  f.active(original); f.move(button);
  assert.equal(f.doc.activeElement, original);
  assert.deepEqual(f.focused, []);
  assert.deepEqual(f.highlights(), ['button']);
  assert.equal(original.classes.has('pointer-focus-muted'), true);
  f.move(original);
  assert.deepEqual(f.highlights(), ['original']);
  assert.equal(original.classes.has('pointer-focus-muted'), false);
});

test('nested icons resolve to their action; empty space clears hover rather than leaving a second ring', () => {
  const f = fixture(), button = f.node('button'), other = f.node('other');
  f.active(button); f.move({ closest() { return other; } });
  assert.deepEqual(f.highlights(), ['other']);
  f.move({ closest() { return null; } });
  assert.deepEqual(f.highlights(), []);
  assert.equal(f.doc.activeElement, button);
  f.key('ArrowDown');
  assert.deepEqual(f.highlights(), ['button']);
  assert.equal(button.classes.has('pointer-focus-muted'), false);
});

test('the first navigation key hands off once from the hovered target without consuming movement or activation', () => {
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' ', 'Tab']) {
    const f = fixture(), first = f.node('first'), second = f.node('second');
    f.active(first); f.move(second); f.key(key);
    assert.equal(f.doc.activeElement, second, key);
    assert.equal(f.focused.length, 1);
    assert.deepEqual(f.highlights(), ['second']);
    f.key(key); assert.equal(f.focused.length, 1);
    assert.equal(first.classes.has('pointer-focus-muted'), false);
  }
});

test('typing, composition and modified shortcuts retain the original editor or keyboard target', () => {
  for (const tagName of ['INPUT', 'TEXTAREA', 'DIV']) {
    for (const key of ['ArrowDown', 'Enter', 'Tab', 'a']) {
      const f = fixture(), input = f.node('editor', tagName), button = f.node('button');
      if (tagName === 'DIV') input.isContentEditable = true;
      f.active(input); f.move(button); f.key(key);
      assert.equal(f.doc.activeElement, input);
      assert.deepEqual(f.focused, []);
      assert.deepEqual(f.highlights(), ['editor']);
    }
  }
  for (const extra of [{ isComposing: true }, { keyCode: 229 }, { ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
    const f = fixture(), first = f.node('first'), second = f.node('second');
    f.active(first); f.move(second); f.key('Enter', extra);
    assert.equal(f.doc.activeElement, first);
  }
});

test('Escape preserves the existing modal return anchor instead of focusing what the cursor happens to cover', () => {
  const f = fixture(), first = f.node('first'), second = f.node('second');
  f.active(first); f.move(second); f.key('Escape');
  assert.equal(f.doc.activeElement, first);
  assert.deepEqual(f.highlights(), ['first']);
});

test('only enabled actions in the current modal can be hovered or receive keyboard handoff', () => {
  const f = fixture(), background = f.node('background'), modal = f.node('modal', 'BUTTON', 'dialog');
  f.setScope('dialog'); f.active(modal); f.move(background);
  assert.deepEqual(f.highlights(), []);
  f.move(modal); assert.deepEqual(f.highlights(), ['modal']);
  modal.disabled = true; f.key('ArrowRight');
  assert.deepEqual(f.focused, []);
});

test('stationary pointer events and scrolling cannot take back programmatically restored keyboard focus', () => {
  const f = fixture(), first = f.node('first'), second = f.node('second');
  f.active(first); f.move(second, { clientX: 40 });
  f.active(first); f.move(second, { clientX: 40 });
  assert.deepEqual(f.highlights(), ['first']);
  f.move(second, { clientX: 41 }); f.listeners.scroll();
  assert.deepEqual(f.highlights(), []);
  f.move(second, { clientX: 41 }); assert.deepEqual(f.highlights(), []);
  f.key('ArrowDown'); assert.equal(f.doc.activeElement, first);
});

test('mouse click establishes an opener before the action runs, uses preventScroll and does not consume the click', () => {
  const f = fixture(), original = f.node('original'), opener = f.node('opener');
  f.active(original); f.move(opener);
  f.listeners.pointerdown({ target: opener, pointerType: 'mouse', button: 0 });
  assert.equal(f.doc.activeElement, opener);
  assert.deepEqual(f.focused, [{ id: 'opener', options: { preventScroll: true } }]);
  f.controller.focusChanged(original);
  assert.deepEqual(f.highlights(), ['original']);
  assert.equal(original.classes.has('pointer-focus-muted'), false);
});

test('leaving or blurring the window clears mouse highlights; touch and pen do not enable desktop hover', () => {
  const f = fixture(), original = f.node('original'), other = f.node('other');
  f.active(original);
  for (const pointerType of ['touch', 'pen']) {
    f.move(other, { pointerType });
    f.listeners.pointerdown({ target: other, pointerType, button: 0 });
    assert.deepEqual(f.highlights(), ['original']);
  }
  f.move(other); f.listeners.mouseout({ relatedTarget: original });
  assert.deepEqual(f.highlights(), ['other']);
  f.listeners.mouseout({ relatedTarget: null }); assert.deepEqual(f.highlights(), []);
  f.move(other); f.windowListeners.blur(); assert.deepEqual(f.highlights(), []);
});

test('mouse events provide the same behavior on a desktop WebView without PointerEvent', () => {
  const f = fixture(false), first = f.node('first'), second = f.node('second');
  f.active(first); f.move(second); f.key('ArrowDown');
  assert.equal(f.doc.activeElement, second);
  assert.equal(typeof f.listeners.mousedown, 'function');
});
