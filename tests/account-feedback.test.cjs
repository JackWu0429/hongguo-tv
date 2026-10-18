const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ui = '../core/cmd/hongguotv/ui/';
const source = fs.readFileSync(require.resolve(ui + 'app.js'), 'utf8');

function runtime(locale) {
  const nodes = {};
  const document = {
    body: {}, documentElement: {}, addEventListener() {}, querySelectorAll() { return []; },
    getElementById(id) {
      if (!nodes[id]) nodes[id] = { textContent: '', hidden: false, insertBefore(child) { child.parentNode = this; }, classList: {
        toggle(name, value) { if (name === 'is-hidden') nodes[id].hidden = value; }
      } };
      return nodes[id];
    }
  };
  document.activeElement = document.body;
  const context = vm.createContext({ document, accountData: null, accountBusy: false, accountNotice: '', accountNoticeIsError: false,
    accountRequestGeneration: 0, confirmOpen: false, pageMode() { return 'account'; },
    focusables() { return []; }, firstContentFocus() { return document.body; }, goFocus() {},
    uiText(key, fallback, params) { return context.HongguoI18n.t(key, params, fallback); },
    renderAccount() { context.renderAccountMessages(context.accountData || {}, !!(context.accountData && context.accountData.app_code_available)); },
    acceptAccountStatus(data) { context.accountData = data; context.renderAccount(); }
  });
  context.window = context;
  for (const file of ['locales/zh-CN.js', 'locales/zh-TW.js', 'locales/ja-JP.js', 'i18n.js']) {
    vm.runInContext(fs.readFileSync(require.resolve(ui + file), 'utf8'), context);
  }
  context.HongguoI18n.setLocale(locale);
  vm.runInContext(source.slice(source.indexOf('  function apiError('), source.indexOf('  function phoneCountryName(')), context);
  vm.runInContext(source.slice(source.indexOf('  function accountFailureText('), source.indexOf('  function pollAccount(')), context);
  vm.runInContext(source.slice(source.indexOf('  function accountRequest('), source.indexOf('  function accountSendCode(')), context);
  return { context, nodes };
}

for (const locale of ['zh-CN', 'zh-TW', 'ja-JP']) {
  test(locale + ': failed SMS keeps both the exact reason and App-code guidance, including after polling', async () => {
    const { context, nodes } = runtime(locale);
    const reason = '测试发码请求被拒绝（1003）';
    const data = { phase: 'phone', error: reason, app_code_available: true };
    context.fetch = async () => ({ status: 400, json: async () => ({ ok: false, error: reason, data }) });
    assert.equal(await context.accountRequest('send-code', {}), false);
    assert.ok(nodes['account-message'].textContent.includes(reason));
    assert.equal(nodes['account-app-code-help'].hidden, false);
    assert.equal(nodes['account-app-code-help'].textContent, context.HongguoI18n.t('ui.appCodeFallback'));
    assert.equal(nodes['account-feedback'].parentNode, nodes['account-login-form']);
    context.accountNotice = '';
    context.acceptAccountStatus(data);
    assert.ok(nodes['account-message'].textContent.includes(reason));
    assert.equal(nodes['account-app-code-help'].hidden, false);
  });
}

test('MFA, cancellation and successful login clear App-code guidance and stale failure text', () => {
  const { context, nodes } = runtime('zh-CN');
  for (const data of [{ phase: 'mfa', app_code_available: true }, { phase: 'phone' }, { phase: 'logged_in', logged_in: true }]) {
    context.renderAccountMessages({ phase: 'phone', error: 'HTTP 403' }, true);
    context.renderAccountMessages(data, !!data.app_code_available);
    assert.equal(nodes['account-app-code-help'].hidden, true);
    assert.equal(nodes['account-app-code-help'].textContent, '');
    assert.equal(nodes['account-message'].textContent, '');
    assert.equal(nodes['account-feedback'].hidden, true);
  }
});

test('changing locale immediately retranslates both messages without discarding the original error', () => {
  const { context, nodes } = runtime('zh-CN');
  const reason = '测试发码请求被拒绝（1003）';
  context.accountData = { phase: 'phone', error: reason, app_code_available: true };
  context.setAccountMessage(reason, true);
  for (const locale of ['zh-TW', 'ja-JP', 'zh-CN']) {
    context.HongguoI18n.setLocale(locale);
    assert.equal(nodes['account-message'].textContent, context.HongguoI18n.t('ui.accountErrorDetail', { detail: reason }));
    assert.equal(nodes['account-app-code-help'].textContent, context.HongguoI18n.t('ui.appCodeFallback'));
    assert.equal(nodes['account-app-code-help'].hidden, false);
  }
});

test('status updates render text safely and keep normal notices separate from fallback instructions', () => {
  const { context, nodes } = runtime('ja-JP');
  context.renderAccountMessages({ phase: 'phone', error: '<img src=x>（1003）' }, true);
  assert.ok(nodes['account-message'].textContent.includes('<img src=x>（1003）'));
  context.accountNotice = 'notice';
  context.renderAccountMessages({ phase: 'phone' }, true);
  assert.equal(nodes['account-message'].textContent, 'notice');
  assert.equal(nodes['account-app-code-help'].hidden, false);
  assert.match(source, /renderAccountMessages\(data, canSubmitAppCode\)/);
});
