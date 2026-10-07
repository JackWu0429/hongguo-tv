const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/app.js'), 'utf8');
const slice = (a,b) => source.slice(source.indexOf('  function '+a+'('), source.indexOf('  function '+b+'('));
const tick = () => new Promise(r=>setImmediate(r));
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
function fixture({failWrite=false,ready=true}={}) {
  const gate=deferred(), calls=[], writes=[], notices=[];
  const video={currentTime:120,duration:120,paused:false,classList:{remove(){},add(){}},pause(){this.paused=true},removeAttribute(n){delete this[n]},load(){}};
  const elem={classList:{remove(){},add(){}},style:{}};
  const c=vm.createContext({Promise,AbortController,URLSearchParams,Date,Object,Number,Math,clearTimeout,console,
    video,calls,writes,notices,gate,document:{hidden:false,getElementById:id=>id==='hero-video'?video:elem},
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
    slice('continueAfterEpisode','offerNextSeasonReservation')+slice('playFeedItem','renderFeed'),c);
  return {c,gate,calls,writes,notices,video};
}
test('automatic next starts while the completed history fsync is still pending, then saves both episodes in order',async()=>{
  const f=fixture(),old=f.c.activePlayback;
  f.c.saveProgress(true,true);f.c.continueAfterEpisode(old);
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
  f.c.saveProgress(true,true);f.c.continueAfterEpisode(old);await tick();await tick();
  assert.equal(f.video.src,'/media/next.mp4');
  f.c.activePlayback.started=true;f.video.currentTime=0;f.c.saveProgress(true);
  f.gate.resolve();await f.c.libraryQueue;
  assert.equal(f.c.libraryData.entries[0].episode,2);assert.ok(f.notices.some(x=>x.includes('fixture disk failure')));
});
test('explicit selection still waits for saved history and does not use the automatic shortcut',async()=>{
  const f=fixture();f.c.saveProgress(true,true);f.c.playFeedItem(0,2,0);
  await tick();await tick();assert.equal(f.video.src,undefined);assert.ok(!f.calls.includes('source'));
  f.gate.resolve();await tick();await tick();await tick();assert.equal(f.video.src,'/media/next.mp4');
  assert.equal(f.c.activePlayback.timing.automatic_next,false);
});
test('an account change or unloaded library keeps the normal history gate',async()=>{
  for(const type of ['owner','library']){
    const f=fixture(),old=f.c.activePlayback;f.c.saveProgress(true,true);
    if(type==='owner')old.owner=1;else f.c.libraryLoaded=false;
    f.c.playFeedItem(0,2,0,old);await tick();await tick();assert.equal(f.video.src,undefined);
    f.gate.resolve();await tick();await tick();await tick();assert.equal(f.video.src,'/media/next.mp4');
    assert.equal(f.c.activePlayback.timing.automatic_next,false);
  }
});
test('leaving during asynchronous handoff cannot bind the next source',async()=>{
  const f=fixture(),old=f.c.activePlayback,prepare=deferred();
  f.c.episodePrefetch.consume=()=>({promise:prepare.promise,timing:{ready_at:0},cancel(){}});
  f.c.saveProgress(true,true);f.c.continueAfterEpisode(old);await tick();await tick();
  f.c.feedGeneration++;prepare.resolve({path:'/late.mp4'});await tick();
  assert.equal(f.video.src,undefined);assert.ok(!f.calls.includes('source'));f.gate.resolve();await f.c.libraryQueue;
});
