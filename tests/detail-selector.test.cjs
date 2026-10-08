const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/app.js'), 'utf8');
const slice = (a,b) => source.slice(source.indexOf('  function '+a+'('), source.indexOf('  function '+b+'('));
function progress() {
  const c=vm.createContext({activePlayback:null,entry:null});
  vm.runInContext('function libraryEntry(){return entry}'+slice('detailEpisodeNumber','currentDetailEpisode'),c);
  return c;
}
test('selector highlights live playback even while history still refers to an earlier episode',()=>{
  const c=progress();c.entry={episode:4};c.activePlayback={item:{series_id:'100'},episode:205};
  assert.equal(c.detailEpisodeNumber({series_id:'100',episode_count:222}),205);
});
test('another series never borrows the playing episode, and completed history highlights the last watched episode',()=>{
  const c=progress();c.entry={episode:5,completed:true};c.activePlayback={item:{series_id:'200'},episode:205};
  assert.equal(c.detailEpisodeNumber({series_id:'100',episode_count:222}),5);
  c.entry=null;assert.equal(c.detailEpisodeNumber({series_id:'100',episode_count:222}),1);
  c.entry={episode:300};assert.equal(c.detailEpisodeNumber({series_id:'100',episode_count:222}),222);
});
test('delayed detail results focus the current episode only while the opening focus is still owned',()=>{
  const target={episode:205};const c=vm.createContext({detailFocusPending:true,detailTab:'episodes',document:{activeElement:{id:'detail-tab-episodes'}},currentDetailEpisode:()=>target,goFocus:n=>c.focused=n});
  vm.runInContext(slice('focusLoadedDetailEpisode','renderDetail'),c);
  c.focusLoadedDetailEpisode();assert.equal(c.focused,target);assert.equal(c.detailFocusPending,false);
  c.focused=null;c.detailFocusPending=true;c.document.activeElement.id='detail-close';c.focusLoadedDetailEpisode();assert.equal(c.focused,null);
  c.document.activeElement.id='detail-tab-episodes';c.detailFocusPending=false;c.focusLoadedDetailEpisode();assert.equal(c.focused,null);
  c.detailFocusPending=true;c.detailTab='series';c.focusLoadedDetailEpisode();assert.equal(c.focused,null);
});
test('episode-grid Up reaches the episodes tab and tab Down returns to the highlighted episode',()=>{
  const tab={id:'detail-tab-episodes'},close={id:'detail-close'},episode={episode:205};
  const c=vm.createContext({detailTab:'episodes',zoneOf:n=>n.zone,moveGrid:()=>null,currentDetailEpisode:()=>episode,firstVisible:()=>null,document:{getElementById:id=>id===tab.id?tab:close,querySelector:()=>tab}});
  vm.runInContext(slice('moveModalFrom','moveFrom'),c);
  assert.equal(c.moveModalFrom({zone:'episodes'},'up'),tab);
  assert.equal(c.moveModalFrom({zone:'detailTabs'},'down'),episode);
  assert.equal(c.moveModalFrom({zone:'modalActions',id:'detail-close'},'down'),tab);
});
test('icon-only actions retain readable names and counts for both saved states',()=>{
  const button={pressed:'false',count:'70.6万',getAttribute:()=>button.pressed,querySelector:()=>({textContent:button.count}),setAttribute:(key,value)=>button.label=value};
  const c=vm.createContext({document:{querySelector:()=>button}});vm.runInContext(slice('updateActionLabel','currentVideoLiked'),c);
  c.updateActionLabel('favorite');assert.equal(button.label,'收藏 · 70.6万');
  button.pressed='true';c.updateActionLabel('favorite');assert.equal(button.label,'已收藏 · 70.6万');
  button.count='1.5万';c.updateActionLabel('like');assert.equal(button.label,'已点赞 · 1.5万');
  c.updateActionLabel('comment');assert.equal(button.label,'评论 · 1.5万');
});
