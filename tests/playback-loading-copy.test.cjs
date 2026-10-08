const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/app.js'), 'utf8');
const functions = source.slice(source.indexOf('  function setPlayerStatus('),source.indexOf('  function setControlIcon('));
function fixture() {
  const classes=(...initial)=>{const set=new Set(initial);return {contains:n=>set.has(n),add:(...v)=>v.forEach(n=>set.add(n)),remove:(...v)=>v.forEach(n=>set.delete(n)),toggle(n,on){if(on)set.add(n);else set.delete(n)}}};
  const node=(...initial)=>({textContent:'',classList:classes(...initial)});
  const hero=node('is-feed','is-preparing-video'),title=node('is-hidden'),text=node(),spinner=node(),retry=node('is-hidden'),panel=node('is-hidden');
  panel.querySelector=selector=>{assert.equal(selector,'.player-spinner');return spinner};
  const nodes={'hero':hero,'player-status':panel,'player-status-title':title,'player-status-text':text,'player-retry':retry};
  const c=vm.createContext({document:{getElementById:id=>nodes[id]},activePlayback:null,featuredItem:{title:'新剧名称'},reveals:0,focused:null,zoneOf:()=> 'feed'});
  vm.runInContext('function revealControls(){reveals++}function goFocus(node){focused=node}'+functions,c);
  return {c,hero,title,text,spinner,retry,panel};
}
test('first start keeps the new title and unknown/resolved episode together without replacing the spinner',()=>{
  const f=fixture(),spinner=f.spinner;
  f.c.setPlayerStatus(f.c.episodeLoadingText(0));
  assert.equal(f.title.textContent,'新剧名称');assert.equal(f.title.classList.contains('is-hidden'),false);
  assert.equal(f.text.textContent,'');assert.equal(f.text.classList.contains('is-hidden'),true);
  assert.equal(f.hero.classList.contains('is-transition-loading'),true);assert.equal(f.panel.classList.contains('is-hidden'),false);
  f.c.setPlayerStatus(f.c.episodeLoadingText(7));
  assert.equal(f.text.textContent,'第 7 集');assert.equal(f.text.classList.contains('is-hidden'),false);assert.equal(f.panel.querySelector('.player-spinner'),spinner);
  assert.equal(f.c.reveals,0);
});
test('same-drama episode switches use the target episode alone, with no repeated title',()=>{
  const f=fixture();f.hero.classList.add('is-episode-transition');
  f.c.setPlayerStatus(f.c.episodeLoadingText(28));
  assert.equal(f.title.textContent,'');assert.equal(f.title.classList.contains('is-hidden'),true);
  assert.equal(f.text.textContent,'第 28 集');assert.equal(f.hero.classList.contains('is-transition-loading'),true);
});
test('natural continuation hides scattered copy even while the next episode detail is still pending',()=>{
  const f=fixture();f.hero.classList.remove('is-preparing-video');f.c.activePlayback={started:true,continuationPending:true};
  f.c.setPlayerStatus(f.c.episodeLoadingText(4));
  assert.equal(f.hero.classList.contains('is-transition-loading'),true);
  assert.equal(f.title.classList.contains('is-hidden'),true);assert.equal(f.title.textContent,'');
  assert.equal(f.text.textContent,'第 4 集');
});
test('switching to another drama replaces old copy and clearing loading restores normal visibility ownership',()=>{
  const f=fixture();f.hero.classList.add('is-episode-transition');f.c.setPlayerStatus(f.c.episodeLoadingText(2));
  f.hero.classList.remove('is-episode-transition');f.c.featuredItem={title:'另一部剧 · 更新后的标题'};
  f.c.setPlayerStatus(f.c.episodeLoadingText(9));
  assert.equal(f.title.textContent,'另一部剧 · 更新后的标题');assert.equal(f.title.classList.contains('is-hidden'),false);
  f.hero.classList.remove('is-preparing-video');f.c.setPlayerStatus('');
  assert.equal(f.hero.classList.contains('is-transition-loading'),false);
  assert.equal(f.title.textContent,'');assert.equal(f.panel.classList.contains('is-hidden'),true);assert.equal(f.text.classList.contains('is-hidden'),true);
  assert.equal(f.c.reveals,0);
});
test('ordinary buffering and failure do not retain a stale incoming title or transition copy suppression',()=>{
  const f=fixture();f.c.setPlayerStatus(f.c.episodeLoadingText(3));
  f.hero.classList.remove('is-preparing-video');f.c.activePlayback={started:true};
  f.c.setPlayerStatus('正在缓冲…');
  assert.equal(f.hero.classList.contains('is-transition-loading'),false);assert.equal(f.title.textContent,'');
  assert.equal(f.text.textContent,'正在缓冲…');assert.equal(f.text.classList.contains('is-hidden'),false);
  assert.equal(f.spinner.classList.contains('is-hidden'),false);
  f.hero.classList.add('is-preparing-video');f.c.setPlayerStatus('暂时无法播放这集',true);
  assert.equal(f.hero.classList.contains('is-transition-loading'),false);assert.equal(f.title.classList.contains('is-hidden'),true);
  assert.equal(f.spinner.classList.contains('is-hidden'),true);assert.equal(f.retry.classList.contains('is-hidden'),false);
  assert.equal(f.text.textContent,'暂时无法播放这集');assert.equal(f.text.classList.contains('is-hidden'),false);
  assert.equal(f.c.reveals,1);assert.equal(f.c.focused,f.retry);
});
