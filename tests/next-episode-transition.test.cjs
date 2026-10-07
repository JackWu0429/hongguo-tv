const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/app.js'), 'utf8');
const slice = (a,b) => source.slice(source.indexOf('  function '+a+'('), source.indexOf('  function '+b+'('));
const tick = () => new Promise(r=>setImmediate(r));
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
function fixture({failWrite=false,ready=true}={}) {
  const gate=deferred(), calls=[], writes=[], notices=[], frames=new Map();let frameID=0;
  function classes(...initial){const names=new Set(initial);return {add(...x){x.forEach(n=>names.add(n))},remove(...x){x.forEach(n=>names.delete(n))},contains(n){return names.has(n)},toggle(n,on){if(on)names.add(n);else names.delete(n)},names}}
  const hero={classList:classes('is-feed'),style:{}};
  const video={currentTime:120,duration:120,paused:false,ended:false,readyState:4,classList:classes('has-source'),pause(){this.paused=true},removeAttribute(n){delete this[n]},load(){calls.push('load');assert.equal(hero.classList.contains('is-preparing-video'),true)}};
  const elem={classList:classes(),style:{}};
  const paint=()=>{const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn())};
  const c=vm.createContext({Promise,AbortController,URLSearchParams,Date,Object,Number,Math,clearTimeout,console,
    requestAnimationFrame(fn){frames.set(++frameID,fn);return frameID},cancelAnimationFrame(id){frames.delete(id)},
    video,calls,writes,notices,gate,document:{hidden:false,getElementById:id=>id==='hero-video'?video:id==='hero'?hero:elem},
    fetch:async(url,options)=>{
      assert.equal(url,'/api/v1/library');const change=JSON.parse(options.body);calls.push('history:'+change.episode);writes.push(change);
      if(change.episode===1)await gate.promise;
      return {ok:!(failWrite&&change.episode===1),json:async()=>({ok:!(failWrite&&change.episode===1),error:'fixture disk failure',data:{owner_id:'123',entries:[{drama:change.drama,episode:change.episode}]}})};
    },
    fetchData:async url=>{calls.push('source');assert.match(url,/\/api\/v1\/play\/info\?/);return {path:'/media/next.mp4',quality:'720P',qualities:['720P']};}
  });
  vm.runInContext(`
    var accountEpoch=2,feedGeneration=1,continuationGeneration=0,seasonSwitchRequest=null;
    var detailModalOpen=false,qualityPrevious=null,applicationInBackground=false;
    var libraryData={owner_id:'123',entries:[]},libraryLoaded=${ready},libraryError='';
    var libraryReady=Promise.resolve(),libraryQueue=Promise.resolve();
    var playbackInfoRequest=null,playbackPrefetchHandoff=null,playbackRequest=null,controlsTimer=null;
    var playbackQuality='',playbackQualities=[],playbackPreferences={quality:'720P'},feedIndex=0;
    var feedItems=[{series_id:'9001',title:'fixture',episode_count:3,vid_list:['111','222','333']}];
    var activePlayback={item:feedItems[0],episode:1,vid:'111',owner:2,generation:1,started:true,lastWrite:0,completed:false};
    var episodePrefetch={keepFor:function(){},consume:function(){return {promise:Promise.resolve({path:'/media/next.mp4'}),timing:{started_at:1,ready_at:2},cancel:function(){}}}};
    function pageMode(){return 'player'}function isPlaybackPage(){return true}function isLibraryPage(){return false}
    function basicDrama(x){return x}function firstVid(x){return x.vid_list[0]}
    function getDetail(x){return Promise.resolve(x)}function libraryEntry(){return null}function resumeEpisode(){return 1}
    function closePlayerOptions(){}function closeDiscussion(){}function resetDanmaku(){}function cancelPlaybackPreparation(){}
    function updateFeedCounter(){}function setFeatured(){}function updateSeriesRows(){}function updatePlaybackControls(){}
    function updateSavedButtons(){}function updateDetailProgress(){}function renderLibrary(){}
    function episodeLoadingText(){return 'loading'}function setPlayerStatus(){}function revealControls(){}
    function showNotice(x){notices.push(x)}function playMedia(){calls.push('play');return Promise.resolve()}
  `+slice('changeLibrary','toggleSaved')+slice('saveProgress','continueAfterEpisode')+
    slice('continueAfterEpisode','offerNextSeasonReservation')+slice('waitForPlaybackPaint','renderFeed'),c);
  return {c,gate,calls,writes,notices,video,hero,paint,frames};
}
test('automatic next starts while the completed history fsync is still pending, then saves both episodes in order',async()=>{
  const f=fixture(),old=f.c.activePlayback;
  f.c.saveProgress(true,true);f.c.continueAfterEpisode(old);
  await tick();f.paint();f.paint();
  await tick();await tick();
  assert.equal(f.video.src,'/media/next.mp4');assert.equal(f.c.activePlayback.episode,2);
  assert.equal(f.writes.length,1);assert.equal(f.writes[0].episode,1);assert.equal(f.writes[0].completed,true);
  assert.ok(f.calls.includes('source'));assert.ok(f.calls.includes('play'));
  f.c.activePlayback.started=true;f.video.currentTime=0;f.c.saveProgress(true);
  await tick();assert.equal(f.writes.length,1);
  f.gate.resolve();await f.c.libraryQueue;
  assert.deepEqual(f.writes.map(x=>[x.episode,x.completed]),[[1,true],[2,false]]);
  assert.equal(f.c.libraryData.entries[0].episode,2);
});
test('a failed completion write is reported without stopping the already prepared next episode or poisoning later saves',async()=>{
  const f=fixture({failWrite:true}),old=f.c.activePlayback;
  f.c.saveProgress(true,true);f.c.continueAfterEpisode(old);await tick();f.paint();f.paint();await tick();await tick();
  assert.equal(f.video.src,'/media/next.mp4');
  f.c.activePlayback.started=true;f.video.currentTime=0;f.c.saveProgress(true);
  f.gate.resolve();await f.c.libraryQueue;
  assert.equal(f.c.libraryData.entries[0].episode,2);assert.ok(f.notices.some(x=>x.includes('fixture disk failure')));
});
test('explicit selection still waits for saved history and does not use the automatic shortcut',async()=>{
  const f=fixture();f.c.saveProgress(true,true);f.c.playFeedItem(0,2,0);
  f.paint();f.paint();
  await tick();await tick();assert.equal(f.video.src,undefined);assert.ok(!f.calls.includes('source'));
  f.gate.resolve();await tick();await tick();await tick();assert.equal(f.video.src,'/media/next.mp4');
  assert.equal(f.c.activePlayback.timing.automatic_next,false);
});
test('an account change or unloaded library keeps the normal history gate',async()=>{
  for(const type of ['owner','library']){
    const f=fixture(),old=f.c.activePlayback;f.c.saveProgress(true,true);
    if(type==='owner')old.owner=1;else f.c.libraryLoaded=false;
    f.c.playFeedItem(0,2,0,old);await tick();await tick();assert.equal(f.video.src,undefined);
    f.paint();f.paint();
    f.gate.resolve();await tick();await tick();await tick();assert.equal(f.video.src,'/media/next.mp4');
    assert.equal(f.c.activePlayback.timing.automatic_next,false);
  }
});
test('leaving during asynchronous handoff cannot bind the next source',async()=>{
  const f=fixture(),old=f.c.activePlayback,prepare=deferred();
  f.c.episodePrefetch.consume=()=>({promise:prepare.promise,timing:{ready_at:0},cancel(){}});
  f.c.saveProgress(true,true);f.c.continueAfterEpisode(old);await tick();f.paint();f.paint();await tick();await tick();
  f.c.feedGeneration++;prepare.resolve({path:'/late.mp4'});await tick();
  assert.equal(f.video.src,undefined);assert.ok(!f.calls.includes('source'));f.gate.resolve();await f.c.libraryQueue;
});
test('same-drama selection keeps the opaque cover and skips its poster before the native video reset',async()=>{
  const f=fixture();f.gate.resolve();f.c.playFeedItem(0,2,0);
  assert.equal(f.hero.classList.contains('is-episode-transition'),true);
  assert.equal(f.hero.classList.contains('is-preparing-video'),true);
  assert.equal(f.video.classList.contains('has-source'),false);
  assert.ok(!f.calls.includes('load'));
  f.paint();await tick();assert.ok(!f.calls.includes('load'));
  f.paint();await tick();await tick();
  assert.equal(f.video.src,'/media/next.mp4');assert.equal(f.calls.filter(x=>x==='load').length,2);
  assert.equal(f.hero.classList.contains('is-preparing-video'),true);
});
test('first start and a different drama keep the loading poster, including after a previous same-drama transition',async()=>{
  for(const type of ['first','different']){
    const f=fixture();f.gate.resolve();f.hero.classList.add('is-episode-transition','is-starting-video');
    if(type==='first')f.c.activePlayback=null;
    else f.c.feedItems=[{series_id:'9002',vid_list:['111'],episode_count:1}];
    f.c.playFeedItem(0,1,0);
    assert.equal(f.hero.classList.contains('is-episode-transition'),false);
    assert.equal(f.hero.classList.contains('is-starting-video'),false);
    f.paint();f.paint();await tick();await tick();
    assert.equal(f.video.src,'/media/next.mp4');
  }
});
test('cancel or leave before cover paint never resets or binds a stale source',async()=>{
  for(const type of ['abort','generation','background']){
    const f=fixture();f.c.playFeedItem(0,2,0);
    if(type==='abort')f.c.playbackInfoRequest.abort();
    else if(type==='generation')f.c.feedGeneration++;
    else f.c.applicationInBackground=true;
    f.paint();f.paint();await tick();await tick();
    assert.ok(!f.calls.includes('load'));assert.ok(!f.calls.includes('source'));
    assert.equal(f.frames.size,0);
  }
});
test('starting video is painted under the cover before the cover and its one loading panel are released',async()=>{
  const f=fixture();f.gate.resolve();f.c.playFeedItem(0,2,0);f.paint();f.paint();await tick();await tick();
  const playback=f.c.activePlayback;playback.started=true;playback.stableSince=Date.now();f.video.paused=false;
  f.c.finishPlaybackPreparation(playback);
  assert.equal(f.hero.classList.contains('is-starting-video'),true);
  f.paint();await tick();assert.equal(f.hero.classList.contains('is-preparing-video'),true);
  f.paint();await tick();
  assert.equal(f.hero.classList.contains('is-preparing-video'),false);
  assert.equal(f.hero.classList.contains('is-episode-transition'),false);
  assert.equal(f.hero.classList.contains('is-starting-video'),false);
});
test('pause, buffering, or a superseding switch keeps its cover despite an older playing event',async()=>{
  for(const type of ['pause','waiting','next']){
    const f=fixture();f.gate.resolve();f.c.playFeedItem(0,2,0);f.paint();f.paint();await tick();await tick();
    const playback=f.c.activePlayback;playback.started=true;playback.stableSince=Date.now();f.video.paused=false;
    f.c.finishPlaybackPreparation(playback);
    if(type==='pause')f.video.paused=true;
    else if(type==='waiting')playback.stableSince=0;
    else {f.c.playFeedItem(0,3,0);}
    f.paint();f.paint();await tick();
    assert.equal(f.hero.classList.contains('is-preparing-video'),true);
  }
});
