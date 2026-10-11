const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/app.js'), 'utf8');
const start = source.indexOf('  function likedEpisodeSummary(');
const end = source.indexOf('  function basicDrama(');
const functions = source.slice(start, end);

test('likes cards summarize the exact liked episodes', () => {
  const context = vm.createContext({});
  vm.runInContext(functions, context);
  assert.equal(context.likedEpisodeSummary({liked_videos: [{episode: 18}, {episode: 18}, {episode: 22}]}, {episode_count: 29}), '赞了第18、22集');
  assert.equal(context.likedEpisodeSummary({liked_videos: [{episode: 25}, {episode: 2}, {episode: 18}, {episode: 7}, {episode: 12}]}, {episode_count: 29}), '赞了第2、7、12等5集');
  assert.equal(context.likedEpisodeSummary({liked_videos: []}, {episode_count: 29}), '已点赞');
});
