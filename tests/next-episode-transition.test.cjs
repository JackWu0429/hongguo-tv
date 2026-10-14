const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/app.js'), 'utf8');
const slice = (a,b) => source.slice(source.indexOf('  function '+a+'('), source.indexOf('  function '+b+'('));
const tick = () => new Promise(r=>setImmediate(r));
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
function fixture({failWrite=false,ready=true,engine='standard'}={}) {
  const gate=deferred(), calls=[], writes=[], notices=[], frames=new Map(), handlers={}, timers=[];let frameID=0;
  function classes(...initial){const names=new Set(initial);return {add(...x){x.forEach(n=>names.add(n))},remove(...x){x.forEach(n=>names.delete(n))},contains(n){return names.has(n)},toggle(n,on){if(on)names.add(n);else names.delete(n)},names}}
  const hero={classList:classes('is-feed'),style:{}};
  const video={currentTime:120,duration:120,paused:false,ended:false,seeking:false,readyState:4,videoWidth:720,videoHeight:1280,muted:false,volume:.75,classList:classes('has-source'),getAttribute(n){return this[n]||null},addEventListener(name,fn){handlers[name]=fn},pause(){this.paused=true},removeAttribute(n){delete this[n]},load(){calls.push('load');assert.equal(hero.classList.contains('is-preparing-video'),true)}};
  const elem={classList:classes(),style:{}};
  const paint=()=>{const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn())};
  const c=vm.createContext({Promise,AbortController,URLSearchParams,Date,Object,Number,Math,clearTimeout,console,
    setTimeout(fn,delay){timers.push({fn,delay});return timers.length},
    requestAnimationFrame(fn){frames.set(++frameID,fn);return frameID},cancelAnimationFrame(id){frames.delete(id)},
    engine,video,calls,writes,notices,gate,document:{hidden:false,getElementById:id=>id==='hero-video'?video:id==='hero'?hero:elem},
    fetch:async(url,options)=>{
      assert.equal(url,'/api/v1/library');const change=JSON.parse(options.body);calls.push('history:'+change.episode);writes.push(change);
      if(change.episode===1)await gate.promise;
      return {ok:!(failWrite&&change.episode===1),json:async()=>({ok:!(failWrite&&change.episode===1),error:'fixture disk failure',data:{owner_id:'123',entries:[{drama:change.drama,episode:change.episode}]}})};
    },
    fetchData:async url=>{calls.push('source');assert.match(url,/\/api\/v1\/play\/info\?/);return {path:'/media/next.mp4',quality:'720P',qualities:['720P']};}
  });
  vm.runInContext("var desktopShell=false;" + source.match(/  function applicationHidden[^\n]+/)[0], c);
  vm.runInContext(`
    var accountEpoch=2,feedGeneration=1,continuationGeneration=0,seasonSwitchRequest=null;
    var rangeTransitionTimer=null;
    var rangePlaybackEnabled=function(){return engine==='range'};
    var detailModalOpen=false,qualityPrevious=null,applicationInBackground=false;
    var libraryData={owner_id:'123',entries:[]},libraryLoaded=${ready},libraryError='';
    var libraryReady=Promise.resolve(),libraryQueue=Promise.resolve();
    var playbackInfoRequest=null,playbackPrefetchHandoff=null,playbackRequest=null,controlsTimer=null,playbackAudioHold=null,playbackTiming=[];
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
    function episodeLoadingText(){return 'loading'}function setPlayerStatus(text,failed){calls.push('status:'+text);if(failed&&activePlayback&&activePlayback.presentation)activePlayback.presentation.failed=true}function revealControls(){}
    function tickDanmaku(){}function scheduleControlsHide(){}function maybePrefetchNextEpisode(){}
    function showNotice(x){notices.push(x)}function playMedia(){calls.push('play');return Promise.resolve()}
  `+slice('changeLibrary','toggleSaved')+slice('saveProgress','continueAfterEpisode')+
    slice('continueAfterEpisode','offerNextSeasonReservation')+slice('holdPlaybackAudio','renderFeed'),c);
  vm.runInContext('var media=video;'+source.slice(source.indexOf("  media.addEventListener('playing'"),source.indexOf("  media.addEventListener('ended'")),c);
  return {c,gate,calls,writes,notices,video,hero,paint,frames,handlers,timers};
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
test('same-series Range switch holds the old frame and delays its spinner for 320ms',()=>{
  const f=fixture({engine:'range'});f.video.src='/media/current.mp4';f.c.playFeedItem(0,2,0);
  assert.equal(f.hero.classList.contains('is-range-transition'),true);
  assert.equal(f.hero.classList.contains('is-range-transition-loading'),false);
  assert.equal(f.video.classList.contains('has-source'),true);
  const timer=f.timers.find(x=>x.delay===320);assert.ok(timer);timer.fn();
  assert.equal(f.hero.classList.contains('is-range-transition-loading'),true);
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
    else if(type==='waiting'){f.handlers.waiting();f.video.readyState=2;}
    else {f.c.playFeedItem(0,3,0);}
    f.paint();f.paint();await tick();
    assert.equal(f.hero.classList.contains('is-preparing-video'),true);
  }
});

async function prepared(options){
  const f=fixture(options);f.gate.resolve();f.c.playFeedItem(0,2,0);
  f.paint();f.paint();await tick();await tick();f.video.paused=false;f.video.currentTime=0;
  return f;
}
async function present(f){f.paint();f.paint();await tick();f.paint();await tick();}
test('history seeking between playing and cover paint retries without another playing event',async()=>{
  const f=await prepared();f.handlers.playing();f.paint();
  f.video.seeking=true;f.handlers.seeking();f.paint();await tick();
  assert.equal(f.hero.classList.contains('is-preparing-video'),true);assert.equal(f.video.muted,true);
  f.video.currentTime=39;f.video.seeking=false;f.handlers.seeked();
  await present(f);
  assert.equal(f.hero.classList.contains('is-preparing-video'),false);assert.equal(f.video.muted,false);
  assert.equal(f.c.playbackTiming.length,1);assert.equal(f.c.activePlayback.episode,2);
});
test('waiting interrupted presentation recovers through current-source progress without playing or canplay',async()=>{
  const f=await prepared();f.handlers.playing();f.paint();f.handlers.waiting();f.paint();await tick();
  assert.equal(f.hero.classList.contains('is-preparing-video'),true);
  f.video.currentTime=.25;f.handlers.timeupdate();await present(f);
  assert.equal(f.hero.classList.contains('is-preparing-video'),false);assert.equal(f.video.muted,false);
});
test('advancing media can recover a missing playing event without recording the next episode before it starts',async()=>{
  const f=await prepared();assert.equal(f.c.activePlayback.started,false);
  f.video.currentTime=.25;f.handlers.timeupdate();await present(f);await f.c.libraryQueue;
  assert.equal(f.hero.classList.contains('is-preparing-video'),false);assert.equal(f.video.muted,false);
  assert.equal(f.c.activePlayback.started,true);assert.equal(f.c.playbackTiming.length,1);
  assert.equal(f.c.libraryData.entries[0].episode,2);
});
test('a native rendered frame can reveal before playing arrives without writing history early',async()=>{
  const f=await prepared(),writesBefore=f.writes.length;assert.equal(f.c.activePlayback.started,false);
  f.handlers.nativeframe();await present(f);
  assert.equal(f.hero.classList.contains('is-preparing-video'),false);
  assert.equal(f.video.muted,false);
  assert.equal(f.c.activePlayback.started,false);
  assert.equal(f.writes.length,writesBefore);
});
test('early canplay and audio-only/no-video data cannot remove the cover or restore sound',async()=>{
  const f=await prepared();f.handlers.canplay();await present(f);
  assert.equal(f.hero.classList.contains('is-preparing-video'),true);assert.equal(f.video.muted,true);
  f.video.videoWidth=0;f.video.videoHeight=0;f.handlers.playing();f.video.currentTime=.25;f.handlers.timeupdate();await present(f);
  assert.equal(f.hero.classList.contains('is-preparing-video'),true);assert.equal(f.video.muted,true);
  f.video.videoWidth=720;f.video.videoHeight=1280;f.handlers.loadeddata();await present(f);
  assert.equal(f.hero.classList.contains('is-preparing-video'),false);assert.equal(f.video.muted,false);
});
test('sound is restored only after the cover and loading removal receive a paint',async()=>{
  const f=await prepared();f.handlers.playing();
  assert.equal(f.video.muted,true);f.paint();await tick();assert.equal(f.video.muted,true);
  f.paint();await tick();assert.equal(f.hero.classList.contains('is-preparing-video'),false);
  assert.equal(f.calls.at(-1),'status:');assert.equal(f.video.muted,true);
  f.paint();await tick();assert.equal(f.video.muted,false);assert.equal(f.video.volume,.75);
  assert.equal(f.c.playbackAudioHold,null);
});
test('temporary audio hold preserves prior mute and in-transition user choices without changing volume',async()=>{
  for(const initial of [false,true]){
    const f=fixture();f.video.muted=initial;f.gate.resolve();f.c.playFeedItem(0,2,0);
    f.paint();f.paint();await tick();await tick();f.video.paused=false;f.handlers.playing();await present(f);
    assert.equal(f.video.muted,initial);assert.equal(f.video.volume,.75);
  }
  const f=await prepared();f.c.setPlaybackMuted(true);f.handlers.playing();await present(f);assert.equal(f.video.muted,true);
  f.c.holdPlaybackAudio(f.c.feedGeneration);f.c.setPlaybackMuted(false);assert.equal(f.video.muted,true);
  f.c.finishPlaybackPreparation(f.c.activePlayback);f.paint();await tick();assert.equal(f.video.muted,false);assert.equal(f.video.volume,.75);
});
test('stale picture and sound callbacks cannot affect a rapid newer switch',async()=>{
  for(const stage of ['cover','sound']){
    const f=await prepared();f.handlers.playing();const old=f.c.activePlayback;
    if(stage==='sound'){f.paint();f.paint();await tick();}
    f.c.playFeedItem(0,3,0);f.paint();f.paint();await tick();await tick();
    assert.equal(f.c.activePlayback.episode,3);assert.equal(f.hero.classList.contains('is-preparing-video'),true);
    assert.equal(f.video.muted,true);f.c.releasePlaybackAudio(old);assert.equal(f.video.muted,true);
    f.video.paused=false;f.handlers.playing();await present(f);assert.equal(f.video.muted,false);
  }
});
test('pause, background, account changes, source replacement and failure prevent late reveal/unmute',async()=>{
  for(const guard of ['pause','background','hidden','owner','source','error']){
    const f=await prepared();f.handlers.playing();f.paint();
    if(guard==='pause'){f.video.paused=true;f.handlers.pause();}
    else if(guard==='background')f.c.applicationInBackground=true;
    else if(guard==='hidden')f.c.document.hidden=true;
    else if(guard==='owner')f.c.accountEpoch++;
    else if(guard==='source')f.video.src='/other.mp4';
    else f.handlers.error();
    f.paint();await tick();f.video.currentTime=.25;f.handlers.timeupdate();f.handlers.canplay();await present(f);
    assert.equal(f.hero.classList.contains('is-preparing-video'),true,guard);assert.equal(f.video.muted,true,guard);
  }
});
test('sound restore interrupted after cover removal is retried after buffering resumes',async()=>{
  const f=await prepared();f.handlers.playing();f.paint();f.paint();await tick();
  f.handlers.waiting();f.video.readyState=2;f.paint();await tick();assert.equal(f.video.muted,true);
  f.video.currentTime=.25;f.handlers.timeupdate();f.paint();await tick();assert.equal(f.video.muted,false);
});
test('ordinary playback buffering keeps the picture and does not reenter a transition audio hold',async()=>{
  const f=await prepared();f.handlers.playing();await present(f);f.handlers.waiting();
  assert.equal(f.hero.classList.contains('is-preparing-video'),false);assert.equal(f.video.muted,false);
  assert.equal(f.c.playbackAudioHold,null);f.video.currentTime=.25;f.handlers.timeupdate();
  assert.equal(f.calls.at(-1),'status:');assert.equal(f.video.muted,false);
});
test('rebinding quality invalidates old presentation callbacks; paused exit restores user mute safely',async()=>{
  const f=await prepared();f.handlers.playing();f.paint();
  f.c.bindPlaybackPresentation(f.c.activePlayback,'/new-quality.mp4');f.video.src='/new-quality.mp4';
  f.paint();await tick();assert.equal(f.hero.classList.contains('is-preparing-video'),true);
  f.handlers.playing();await present(f);assert.equal(f.hero.classList.contains('is-preparing-video'),false);
  f.c.holdPlaybackAudio(f.c.feedGeneration);f.video.paused=true;f.c.releasePlaybackAudio();
  assert.equal(f.video.muted,false);assert.equal(f.video.volume,.75);assert.equal(f.c.playbackAudioHold,null);
});
