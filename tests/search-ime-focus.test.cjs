const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/app.js'), 'utf8');
const activity = fs.readFileSync(require.resolve('../android/app/src/main/java/rocks/aston/hongguotv/MainActivity.java'), 'utf8');

test('Android search focus asks native code for one conditional renderer-focus repair', () => {
  const focusin = app.slice(app.indexOf("document.addEventListener('focusin'"), app.indexOf("document.addEventListener('focusout'"));
  assert.match(focusin, /androidShell[\s\S]*?beginSearchEditing\(typeof document\.hasFocus === 'function' && document\.hasFocus\(\)\)/);
  assert.match(activity, /public void beginSearchEditing\(boolean documentHasFocus\)[\s\S]*?searchEditing = true;[\s\S]*?if \(searchInputFocusPolicy\.shouldRepairRendererFocus\(documentHasFocus\)\)/);
  assert.match(activity, /webView\.clearFocus\(\);\s*webView\.requestFocus\(View\.FOCUS_DOWN\);/);
});

test('search submission explicitly dismisses the native IME while browser behavior stays unchanged', () => {
  const submit = app.slice(app.indexOf('  function submitSearch()'), app.indexOf('  function renderSearchHistory('));
  assert.match(submit, /if \(androidShell && window\.HongguoTVInput[\s\S]*?finishSearchEditing\(\)/);
  assert.match(activity, /public void finishSearchEditing\(\)[\s\S]*?completeSearchEditing\(false\)/);
  const finish = activity.slice(activity.indexOf('    private void completeSearchEditing('), activity.indexOf('    private String mediaCommand('));
  assert.match(finish, /keyboard\.hideSoftInputFromWindow/);
  assert.match(finish, /if \(returnFocusToSearchActions && wasEditing/);
});

test('Back dismisses Android search editing and restores focus to a search action', () => {
  assert.match(activity, /onKeyPreIme\(int keyCode, KeyEvent event\)[\s\S]*?completeSearchEditing\(true\)/);
  assert.match(activity, /InputKeyPolicy\.isBackKey\(keyCode\) && \(accountEditing \|\| searchEditing \|\| inputBackPending\)/);
  assert.match(activity, /if \(InputKeyPolicy\.isBackKey\(event\.getKeyCode\(\)\)\) \{[\s\S]*?requestPageBack\(\)/);
  assert.match(activity, /if \(searchEditing \|\| accountEditing\)[\s\S]*?completeSearchEditing\(true\)/);
  assert.match(app, /finishSearchEditing: function \(\) \{ if \(document\.activeElement === searchInput\) goFocus\(firstSearchAction\(\) \|\| firstSearchFilter\(\)\); \}/);
});

test('general focus restoration avoids an active editor while search repair requires a ready foreground page', () => {
  assert.match(activity, /if \(!repairingSearchInput && \(accountEditing \|\| searchEditing \|\| isKeyboardVisible\(\)\)\) return/);
  assert.match(activity, /private void beginSearchEditingOnUiThread\(boolean documentHasFocus\)[\s\S]*?if \(destroyed \|\| !pageReady \|\| !activityForeground \|\| webView == null\) return/);
});

test('Android keeps D-pad and confirm routed through the search focus graph after leaving the editor', () => {
  const focusinStart = app.indexOf("document.addEventListener('focusin'");
  const focusin = app.slice(focusinStart, app.indexOf("document.querySelectorAll('.side-item')", focusinStart));
  assert.match(focusin, /setRemoteNavigationTarget\(!editingTarget && focusables\(\)\.indexOf\(target\) >= 0\)/);
  assert.match(activity, /searchNavigationState\.routeFallbackNavigationKey\(searchEditing \|\| accountEditing\)/);
  const beginEditing = activity.slice(activity.indexOf('private void beginSearchEditingOnUiThread'), activity.indexOf('@JavascriptInterface\n        public void setRemoteNavigationTarget'));
  assert.match(beginEditing, /searchNavigationState\.arm\(\)/);
  assert.doesNotMatch(beginEditing, /if \(!documentHasFocus\)[\s\S]*?searchNavigationState\.arm\(\)/);
  assert.match(activity, /searchConfirmKeyBit\(event.getKeyCode\(\)\)[\s\S]*?remoteKey\(" \+ event\.getKeyCode\(\)/);
  assert.match(activity, /public void setRemoteNavigationTarget\(boolean active\)[\s\S]*?searchNavigationState\.setRemoteNavigationTarget/);
  assert.match(app, /function remoteKey\(keyCode, repeat\) \{\s*if \(\[19, 20, 21, 22, 23, 66, 160\]/);
});
