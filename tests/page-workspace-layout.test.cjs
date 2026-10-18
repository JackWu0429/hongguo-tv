'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const css = fs.readFileSync(path.join(__dirname, '..', 'core', 'cmd', 'hongguotv', 'ui', 'app.css'), 'utf8');

assert.match(css, /\.main-surface\.has-search \.page-context,\s*\.main-surface\.has-workspace \.page-context \{ display: none; \}/,
  'content pages must not render the duplicate disabled page-context title');
assert.match(css, /\.search-page \{[^}]*top: 72px;[^}]*padding: 12px 34px 50px;/,
  'search content should use the compact top inset');
assert.match(css, /\.page-workspace \{[^}]*top: 72px;[^}]*padding: 12px 34px 50px;/,
  'workspace content should use the compact top inset');

console.log('content page title and top spacing contract: PASS');
