const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const index = fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/index.html'), 'utf8');
const start = index.indexOf('<section id="support-page"');
const end = index.indexOf('<div id="support-modal"', start);
assert.notEqual(start, -1);
assert.notEqual(end, -1);
const supportPage = index.slice(start, end);

test('support page exposes both donation cards with the cleaned QR assets', () => {
  assert.equal((supportPage.match(/class="support-card"/g) || []).length, 2);
  assert.match(supportPage, /data-focus="support-wechat"/);
  assert.match(supportPage, /data-focus="support-alipay"/);
  assert.match(supportPage, /src="\/images\/support-wechat\.png"/);
  assert.match(supportPage, /src="\/images\/support-alipay\.png"/);
});
