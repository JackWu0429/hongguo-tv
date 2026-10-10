const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/app.js'), 'utf8');
const start = source.indexOf('  function followState(');
const end = source.indexOf('  function updateSavedButtons(');
const functions = source.slice(start, end);

function context() {
  const c = vm.createContext({});
  vm.runInContext(functions, c);
  return c;
}

test('follow eligibility maps official ongoing and completed states', () => {
  const c = context();
  assert.equal(c.followState({series_status: '0'}), 'ongoing');
  assert.equal(c.followState({series_status: 0}), 'ongoing');
  assert.equal(c.followState({series_status: '1'}), 'ended');
  assert.equal(c.followState({series_status: '已完结'}), 'ended');
  assert.equal(c.followState({series_status: '连载中'}), 'ongoing');
  assert.equal(c.followState({}), 'unknown');
});

test('follow state still records an existing completed-drama follow', () => {
  const c = context();
  assert.equal(c.followIsActive({series_status: '1', followed: true}), true);
  assert.equal(c.followIsActive({series_status: '1', following_update: true}), true);
  assert.equal(c.followIsActive({series_status: '1'}), false);
});

test('completed dramas hide the follow action even when already followed', () => {
  const copy = {textContent: ''};
  const button = {
    disabled: false,
    pressed: '',
    label: '',
    classList: {
      hidden: false,
      disabledStyle: false,
      toggle(name, value) { if (name === 'is-hidden') this.hidden = value; if (name === 'is-disabled') this.disabledStyle = value; },
      contains() { return false; }
    },
    querySelector: () => copy,
    setAttribute(key, value) { this[key] = value; }
  };
  const c = vm.createContext({
    featuredItem: {series_status: '1'},
    document: {activeElement: null, querySelector: () => button}
  });
  vm.runInContext(functions, c);
  c.updateFollowButton();
  assert.equal(button.disabled, false);
  assert.equal(button.classList.hidden, true);
  assert.equal(button['aria-hidden'], 'true');
  assert.equal(button['aria-label'], '已完结');

  c.featuredItem = {series_status: '1', followed: true};
  c.updateFollowButton();
  assert.equal(button.classList.hidden, true);
  assert.equal(button['aria-hidden'], 'true');
});

test('ongoing and unknown dramas keep the follow action visible', () => {
  const copy = {textContent: ''};
  const button = {
    disabled: true,
    classList: {hidden: true, toggle(name, value) { if (name === 'is-hidden') this.hidden = value; }, contains() { return false; }},
    querySelector: () => copy,
    setAttribute(key, value) { this[key] = value; }
  };
  const c = vm.createContext({
    featuredItem: {series_status: '0'},
    document: {activeElement: null, querySelector: () => button}
  });
  vm.runInContext(functions, c);
  c.updateFollowButton();
  assert.equal(button.classList.hidden, false);
  assert.equal(button['aria-hidden'], 'false');
  assert.equal(copy.textContent, '追更');

  c.featuredItem = {};
  c.updateFollowButton();
  assert.equal(button.classList.hidden, false);
  assert.equal(button['aria-hidden'], 'false');
});

test('hiding a focused completed-drama action returns focus to a visible neighbor', () => {
  const button = {
    disabled: false,
    classList: {toggle() {}, contains() { return false; }},
    querySelector: () => ({textContent: ''}),
    setAttribute() {},
    blur() { doc.activeElement = doc.body; }
  };
  const neighbor = {disabled: false, classList: {contains() { return false; }}};
  button.nextElementSibling = neighbor;
  const doc = {body: {}, activeElement: button, querySelector: () => button};
  const c = vm.createContext({
    featuredItem: {series_status: '1'},
    document: doc,
    goFocus(target) { doc.activeElement = target; }
  });
  vm.runInContext(functions, c);
  c.updateFollowButton();
  assert.equal(doc.activeElement, neighbor);
});
