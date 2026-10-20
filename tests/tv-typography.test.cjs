const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/app.js'), 'utf8');
const compat = fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/compat.css'), 'utf8');

test('TV typography is enabled for TV shells and leaves desktop CSS unscoped', () => {
  assert.match(app, /classList\.toggle\('tv-shell', androidShell \|\| webosShell\)/);

  const tvStyles = compat.slice(compat.lastIndexOf('/* TV text stays readable'));
  assert.match(tvStyles, /html\.tv-shell \.catalog-card-title \{ font-size: 18px; \}/);
  assert.match(tvStyles, /html\.tv-shell \.catalog-card-meta \{ font-size: 13px; \}/);
  assert.match(tvStyles, /html\.tv-shell \.radar-row \{ font-size: 16px; \}/);
  assert.match(tvStyles, /html\.tv-shell \.side-item \{ min-height: 54px;[^}]*font-size: 20px; \}/);
  assert.match(tvStyles, /html\.tv-shell \.side-icon \{ flex-basis: 32px; width: 32px; height: 32px; \}/);
  assert.doesNotMatch(tvStyles, /@media\s*\(max-width/);
});
