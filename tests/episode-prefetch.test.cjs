const {test} = require('node:test');
const assert = require('node:assert/strict');
const {create} = require('../core/cmd/hongguotv/ui/episode-prefetch.js');
const deferred = () => {let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick = () => new Promise(r=>setImmediate(r));
const info = (extra={}) => ({series_id:'123',vid:'111',episode:1,quality:'720P',generation:3,owner:2,
  duration:120,position:76,active:true,started:true,paused:false,ended:false,...extra});
const target = (extra={}) => ({series_id:'123',vid:'222',episode:2,quality:'720P',owner:2,...extra});
function fixture(lookup) {
  const calls=[],signals=[];
  const p=create({lookup:lookup || (async x=>target({quality:x.quality})),prepare:async(x,signal)=>{calls.push(x);signals.push(signal);return {path:'/media/next.mp4'};}});
  return {p,calls,signals};
}
test('starts once after 62 percent or in the final 45 seconds, never before five seconds', async()=>{
  const f=fixture();
  for(const x of [info({position:4,duration:10}),info({position:74,duration:120}),info({paused:true}),info({active:false}),info({started:false}),info({ended:true}),info({duration:NaN}),info({duration:Infinity})]) f.p.maybe(x);
  await tick();assert.equal(f.calls.length,0);
  f.p.maybe(info({position:74.4}));f.p.maybe(info({position:90}));await tick();assert.equal(f.calls.length,1);
  const g=fixture();g.p.maybe(info({duration:60,position:15}));await tick();assert.equal(g.calls.length,1);
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
test('a late metadata reply must match the episode adopted by the foreground',async()=>{
  const lookup=deferred();const f=fixture(()=>lookup.promise);f.p.maybe(info());await tick();
  const next=f.p.consume(target({vid:'999'}));lookup.resolve(target());
  assert.equal(await next.promise,null);assert.equal(f.calls.length,0);
});
