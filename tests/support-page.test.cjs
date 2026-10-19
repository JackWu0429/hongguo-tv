const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const index = fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/index.html'), 'utf8');
const start = index.indexOf('<section id="support-page"');
const end = index.indexOf('<div id="support-modal"', start);
assert.notEqual(start, -1);
assert.notEqual(end, -1);
const supportPage = index.slice(start, end);

test('support page exposes only the WeChat donation card', () => {
  assert.equal((supportPage.match(/class="support-card"/g) || []).length, 1);
  assert.match(supportPage, /data-focus="support-wechat"/);
  assert.doesNotMatch(supportPage, /support-alipay|support-alipay\.png|支付宝打赏/);
});
