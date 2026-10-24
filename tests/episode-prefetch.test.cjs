const {test} = require('node:test');
const assert = require('node:assert/strict');
const {create,nextUnlockedEpisodes} = require('../core/cmd/hongguotv/ui/episode-prefetch.js');
const deferred = () => {let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick = () => new Promise(r=>setImmediate(r));
const info = (extra={}) => ({series_id:'123',vid:'111',episode:1,quality:'720P',generation:3,owner:2,
  duration:120,position:8,stable_seconds:5,active:true,started:true,paused:false,ended:false,...extra});
const target = (extra={}) => ({series_id:'123',vid:'222',episode:2,quality:'720P',owner:2,...extra});
function fixture(lookup) {
  const calls=[],signals=[];
  const p=create({lookup:lookup || (async x=>target({quality:x.quality})),prepare:async(x,signal)=>{calls.push(x);signals.push(signal);return {path:'/media/next.mp4'};}});
  return {p,calls,signals};
}
test('starts once after five stable playback seconds, early in a long episode', async()=>{
  const f=fixture();
  for(const x of [info({stable_seconds:4.99}),info({stable_seconds:0,position:110}),info({stable_seconds:NaN}),info({stable_seconds:undefined}),info({paused:true}),info({active:false}),info({started:false}),info({ended:true}),info({duration:NaN}),info({duration:Infinity})]) f.p.maybe(x);
  await tick();assert.equal(f.calls.length,0);
  f.p.maybe(info());f.p.maybe(info({position:90}));await tick();assert.equal(f.calls.length,1);
  const g=fixture();g.p.maybe(info({duration:600,position:2.5}));await tick();assert.equal(g.calls.length,1);
});
test('a zero threshold starts when playback has just become stable', async()=>{
  const f=fixture();
  f.p.maybe(info({stable_seconds:0,position:0,prefetch_after_seconds:0}));
  await tick();assert.equal(f.calls.length,1);
  const blocked=fixture();
  blocked.p.maybe(info({stable_seconds:0,position:0,prefetch_after_seconds:0,started:false}));
  await tick();assert.equal(blocked.calls.length,0);
});
test('prepared fires once with the path and stays quiet when prepare fails', async()=>{
  const seen=[];
  const f=create({
    lookup: async ()=>target(),
    prepare: async ()=>({path:'/media/next.mp4', mode:'range'}),
    prepared: (info, next, data)=>seen.push([info.episode, next.vid, data.path])
  });
  f.maybe(info({prefetch_after_seconds:0, stable_seconds:0, position:0}));
  f.maybe(info({prefetch_after_seconds:0, stable_seconds:0, position:1}));
  await tick();
  assert.deepEqual(seen, [[1, '222', '/media/next.mp4']]);
  const failed=[];
  const g=create({
    lookup: async ()=>target(),
    prepare: async ()=>{ throw new Error('range'); },
    prepared: ()=>failed.push(1)
  });
  g.maybe(info({prefetch_after_seconds:0, stable_seconds:0, position:0}));
  await tick();
  assert.deepEqual(failed, []);
});
test('a zero threshold does not wait for a duration the decoder has not reported', async()=>{
  const f=fixture();
  f.p.maybe(info({duration:NaN,stable_seconds:0,position:0,prefetch_after_seconds:0}));
  await tick();assert.equal(f.calls.length,1);
  const blocked=fixture();
  blocked.p.maybe(info({duration:0,stable_seconds:0,position:0,prefetch_after_seconds:0}));
  await tick();assert.equal(blocked.calls.length,0);
  blocked.p.maybe(info({duration:NaN,stable_seconds:0,position:0}));
  await tick();assert.equal(blocked.calls.length,0);
});
test('MPV can request an earlier prefetch threshold without changing the default', async()=>{
  const f=fixture();
  f.p.maybe(info({stable_seconds:.99,prefetch_after_seconds:1}));
  await tick();assert.equal(f.calls.length,0);
  f.p.maybe(info({stable_seconds:1,prefetch_after_seconds:1}));
  await tick();assert.equal(f.calls.length,1);
  const g=fixture();
  g.p.maybe(info({stable_seconds:4.99}));
  await tick();assert.equal(g.calls.length,0);
});
test('collects at most four future unlocked VIDs without crossing the current episode',()=>{
  const detail={vid_list:['10','11','12','13','14','15','16'],episodes:[
    {video_id:'10',locked:false},{video_id:'11',locked:false},{video_id:'12',locked:true},
    {video_id:'13',locked:false},{video_id:'14',locked:false},{video_id:'15',locked:false},{video_id:'16',locked:false}
  ]};
  assert.deepEqual(nextUnlockedEpisodes(detail,1,8),[
    {episode:2,vid:'11'},{episode:4,vid:'13'},{episode:5,vid:'14'},{episode:6,vid:'15'}
  ]);
  assert.deepEqual(nextUnlockedEpisodes(detail,1,2),[
    {episode:2,vid:'11'},{episode:4,vid:'13'}
  ]);
});
test('uses accessible count when episode lock flags are unavailable and rejects invalid VIDs',()=>{
  assert.deepEqual(nextUnlockedEpisodes({vid_list:['1','bad','3','4'],accessible_episode_cnt:3},0,4),[
    {episode:1,vid:'1'},{episode:3,vid:'3'}
  ]);
});
test('seek and resume position alone do not bypass the stable interval',async()=>{
  const f=fixture();f.p.maybe(info({position:119,stable_seconds:0}));await tick();assert.equal(f.calls.length,0);
  f.p.maybe(info({position:119,stable_seconds:5}));await tick();assert.equal(f.calls.length,1);
});
test('does not recursively prepare further episodes or another season',async()=>{
  const f=fixture();f.p.maybe(info());await tick();for(let i=0;i<10;i++)f.p.maybe(info({position:110}));await tick();assert.equal(f.calls.length,1);
  for(const next of [null,target({vid:'111'}),target({vid:'bad'}),target({series_id:'456'})]){
    const g=fixture(async()=>next);g.p.maybe(info());await tick();assert.equal(g.calls.length,0);
  }
});
test('switching drama, explicit episode, quality or owner cancels even a late lookup',async()=>{
  for(const args of [['456',2,'720P',2],['123',5,'720P',2],['123',2,'1080P',2],['123',2,'720P',4]]){
    const reply=deferred();let signal;const f=fixture((_,s)=>{signal=s;return reply.promise});
    f.p.maybe(info());await tick();f.p.keepFor(...args);assert.equal(signal.aborted,true);
    reply.resolve(target());await tick();assert.equal(f.calls.length,0);
  }
});
test('natural next episode adopts the pending download without aborting or preparing twice',async()=>{
  const reply=deferred();let downloads=0,signal;
  const p=create({lookup:async()=>target(),prepare:(_,s)=>{downloads++;signal=s;return reply.promise}});
  p.maybe(info());await tick();p.keepFor('123',2,'720P',2);const next=p.consume(target());p.cancel();
  assert.ok(next);assert.equal(signal.aborted,false);reply.resolve({path:'/prepared.mp4'});
  assert.equal((await next.promise).path,'/prepared.mp4');assert.equal(downloads,1);
  assert.equal(p.consume(target()),null);
});
test('pending metadata survives take-over and the foreground owner can cancel it',async()=>{
  const lookup=deferred();let downloads=0,signal;
  const p=create({lookup:(_,s)=>{signal=s;return lookup.promise},prepare:async()=>{downloads++;return {path:'/prepared.mp4'}}});
  p.maybe(info());await tick();const next=p.consume(target());assert.ok(next);
  lookup.resolve(target());assert.equal((await next.promise).path,'/prepared.mp4');assert.equal(downloads,1);
  next.cancel();assert.equal(signal.aborted,true);
});
test('speculative failure stays silent and is handed back as a normal foreground retry',async()=>{
  let attempts=0;const p=create({lookup:async()=>target(),prepare:async()=>{attempts++;throw Error('offline')}});
  p.maybe(info());await tick();p.maybe(info());await tick();assert.equal(attempts,1);
  const next=p.consume(target());assert.equal(await next.promise,null);
});
test('cancel prevents late replies from attaching to a new playback context',async()=>{
  const lookup=deferred();const f=fixture(()=>lookup.promise);f.p.maybe(info());await tick();f.p.cancel();
  lookup.resolve(target());await tick();assert.equal(f.calls.length,0);
  f.p.maybe(info({generation:4}));await tick();assert.equal(f.calls.length,1);
});
test('consume rejects a mismatched VID instead of using the wrong prepared episode',async()=>{
  const f=fixture();f.p.maybe(info());await tick();assert.equal(f.p.consume(target({vid:'999'})),null);assert.equal(f.signals[0].aborted,true);
});
test('a next-episode press waits for the one in-flight prepare instead of starting another',async()=>{
  const reply=deferred();let prepares=0;
  const seen=[];
  const p=create({
    lookup:async()=>target(),
    prepare:()=>{prepares++;return reply.promise;},
    prepared:(info,next,data)=>seen.push(data.path)
  });
  p.maybe(info({prefetch_after_seconds:0,stable_seconds:0,position:0}));
  await tick();
  let delivered=null;
  assert.equal(p.hold('123',2,'720P',2,'',(next)=>{delivered=next;}),'wait');
  assert.equal(prepares,1);
  reply.resolve({path:'/media/next.mp4',mode:'range'});
  await tick();
  assert.equal(prepares,1);
  assert.equal(delivered && delivered.path,'/media/next.mp4');
  assert.deepEqual(seen,['/media/next.mp4']);
});
test('a string episode number still matches the numeric next episode',async()=>{
  const f=fixture();
  f.p.maybe(info({episode:'1',prefetch_after_seconds:0,stable_seconds:0,position:0}));
  await tick();
  assert.equal(f.calls.length,1);
  let matched=false;
  assert.equal(f.p.hold('123',2,'720P',2,'',()=>{matched=true;}),'ready');
  assert.equal(matched,true);
});
test('a failed prepare tells the waiting next-episode press to fall back',async()=>{
  const p=create({lookup:async()=>target(),prepare:async()=>{throw Error('offline');}});
  p.maybe(info({prefetch_after_seconds:0,stable_seconds:0,position:0}));
  await tick();
  assert.equal(p.hold('123',2,'720P',2,'',()=>{}),false);
});
test('a late metadata reply must match the episode adopted by the foreground',async()=>{
  const lookup=deferred();const f=fixture(()=>lookup.promise);f.p.maybe(info());await tick();
  const next=f.p.consume(target({vid:'999'}));lookup.resolve(target());
  assert.equal(await next.promise,null);assert.equal(f.calls.length,0);
});
