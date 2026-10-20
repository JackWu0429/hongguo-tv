const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const source=fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/app.js'),'utf8');
const styles=fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/app.css'),'utf8');
function between(start,end){return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));}
function classes(...initial){const values=new Set(initial);return {add(...names){names.forEach(x=>values.add(x));},remove(...names){names.forEach(x=>values.delete(x));},contains(name){return values.has(name);}};}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function fixture(engine='mpv'){
 const hero={classList:classes('is-preparing-video')};
 const cover={classList:classes(),style:{backgroundImage:'none'}};
 const canvas={classList:classes(),width:0,height:0};
 const video={paused:false,seeking:false,ended:false,readyState:3,videoWidth:1280,videoHeight:720,classList:classes('has-source')};
 const document={getElementById(id){return id==='hero'?hero:id==='hero-episode-cover'?cover:id==='hero-video'?video:id==='hero-last-frame'?canvas:null;}};
 const images=[];
 function Image(){images.push(this);}
 Object.defineProperty(Image.prototype,'src',{set(value){this._src=value;},get(){return this._src;}});
 const paint=deferred();
 const playback={item:{series_id:'series-1'},vid:'vid-2',generation:8,owner:3,presentation:{rendered:false,pending:false,epoch:0}};
 const context=vm.createContext({document,Image,Promise,Date,feedGeneration:8,accountEpoch:3,activePlayback:playback,
   playbackEngineName(){return engine;},clearRangeStallTimer(){},clearRangeTransitionHint(){},clearLastPlaybackFrame(){},
   playbackVideoReady(){return true;},waitForPlaybackPaint(){return paint.promise;},releasePresentedAudio(){},finishAutoCinema(){},setPlayerStatus(){},
   media:video,window:{}});
 vm.runInContext(between('  function clearEpisodeCover(', '  function layoutLastPlaybackFrame'),context);
 return {context,hero,cover,canvas,video,images,paint,playback};
}
const target={series_id:'series-1',vid:'vid-2'};

test('standard same-series switches keep the loaded series cover until the target episode cover is ready',()=>{
 assert.match(styles,/\.hero\.is-preparing-video \.hero-backdrop, \.hero\.is-preparing-video \.hero-loading-poster \{ visibility: visible; \}/);
 assert.match(styles,/\.hero\.is-preparing-video\.is-episode-transition\.is-range-transition \.hero-backdrop, \.hero\.is-preparing-video\.is-episode-transition\.is-range-transition \.hero-loading-poster \{ visibility: hidden; \}/);
 assert.doesNotMatch(styles,/\.hero\.is-preparing-video\.is-episode-transition \.hero-backdrop, \.hero\.is-preparing-video\.is-episode-transition \.hero-loading-poster/);
});

test('only the current episode can reveal its episode_cover for MPV and standard playback',()=>{
 const f=fixture();
 f.context.setEpisodeCover(target,{episode_cover:'https://img.example/episode-2.jpg'});
 assert.equal(f.images.length,1);assert.equal(f.hero.classList.contains('is-episode-cover'),false);
 f.images[0].onload();
 assert.equal(f.cover.style.backgroundImage,'url("https://img.example/episode-2.jpg")');
 assert.equal(f.hero.classList.contains('is-episode-cover'),true);
 const standard=fixture('webview_media3');
 standard.context.setEpisodeCover(target,{episode_cover:'https://img.example/episode-2.jpg'});
 assert.equal(standard.images.length,1);
 standard.images[0].onload();
 assert.equal(standard.hero.classList.contains('is-episode-cover'),true);
});

test('mismatched episode responses never show an episode cover',()=>{
 const stale=fixture();
 stale.context.setEpisodeCover({series_id:'series-1',vid:'vid-old'},{episode_cover:'https://img.example/old.jpg'});
 assert.equal(stale.images.length,0);
});

test('a late image response cannot cover a newer playback generation',()=>{
 const f=fixture();
 f.context.setEpisodeCover(target,{episode_cover:'https://img.example/episode-2.jpg'});
 f.context.feedGeneration++;
 f.images[0].onload();
 assert.equal(f.hero.classList.contains('is-episode-cover'),false);
});

test('Media3 and MPV retain the episode cover until nativeframe crosses the paint boundary',async()=>{
 for(const engine of ['webview_media3','mpv']){
  const f=fixture(engine);
  f.context.setEpisodeCover(target,{episode_cover:'https://img.example/episode-2.jpg'});f.images[0].onload();
  f.context.handlers={};
  f.context.media={paused:false,seeking:false,readyState:3,addEventListener(name,fn){f.context.handlers[name]=fn;}};
  vm.runInContext(between('  function finishPlaybackPreparation(', '  function markPlaybackStarted'),f.context);
  vm.runInContext(between("  media.addEventListener('nativeframe'",'  function checkPlaybackData'),f.context);
  f.context.handlers.nativeframe();
  assert.equal(f.playback.presentation.rendered,true);
  assert.equal(f.hero.classList.contains('is-episode-cover'),true);
  f.paint.resolve(true);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.hero.classList.contains('is-episode-cover'),false);
  assert.equal(f.hero.classList.contains('is-preparing-video'),false);
 }
});

test('cancelling a transition clears the loaded target image',()=>{
 const f=fixture('webview_media3');
 f.context.setEpisodeCover(target,{episode_cover:'https://img.example/episode-2.jpg'});f.images[0].onload();
 f.context.clearEpisodeCover();
 assert.equal(f.hero.classList.contains('is-episode-cover'),false);
 assert.equal(f.cover.style.backgroundImage,'none');
 assert.equal(f.cover.classList.contains('is-ready'),false);
});
