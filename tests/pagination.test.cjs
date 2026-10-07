const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../core/cmd/hongguotv/ui/pagination.js');
const row = id => ({ series_id: id });
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;});return {promise,resolve,reject}; };

test('appends unique cards and keeps server cursor even with overlapping rows', async () => {
  const calls=[], renders=[];
  const p=create({pageSize:2,request:async q=>{calls.push(q);return q.offset ? {items:[row('b'),row('c')],has_more:true,next_offset:20,session_id:'s'} : {items:[row('a'),row('b')],has_more:true,next_offset:10,session_id:'s'};},render:(items,append)=>renders.push({items,append})});
  await p.reset({genre:'comic'}); const first=p.items[0]; await p.load();
  assert.deepEqual(p.items.map(x=>x.series_id),['a','b','c']); assert.equal(p.items[0],first);
  assert.equal(calls[1].offset,10);assert.equal(calls[1].session_id,'s');assert.equal(calls[1].genre,'comic');
  assert.equal(renders[1].append,true);await p.load();assert.equal(p.hasMore(),false);
});
test('late successful and failed replies cannot replace a new filter or account', async () => {
  const old=deferred();const newReply=deferred();const rendered=[];
  const p=create({request:q=>q.kind==='old'?old.promise:newReply.promise,render:items=>rendered.push(...items)});
  const a=p.reset({kind:'old'});await Promise.resolve();const b=p.reset({kind:'new'});await Promise.resolve();
  newReply.resolve({items:[row('new')],has_more:false});await b;old.resolve({items:[row('old')],has_more:true,next_offset:10});await a;
  assert.deepEqual(rendered.map(x=>x.series_id),['new']);assert.equal(p.busy,false);assert.equal(p.error,'');
});
test('request failure retries the same cursor and does not discard existing cards', async () => {
  let attempts=0;const offsets=[];
  const p=create({request:async q=>{offsets.push(q.offset||0);if(++attempts===2)throw Error('offline');return {items:[row(String(attempts))],has_more:true,next_offset:attempts*10};},render:()=>{}});
  await p.reset();await p.load();assert.equal(p.error,'offline');const stable=p.items[0];await p.load();assert.equal(attempts,2);
  await p.load(true);assert.deepEqual(offsets,[0,10,10]);assert.equal(p.items[0],stable);assert.equal(p.error,'');
});
test('concurrent tail triggers issue one request; bounded empty pages stop loops', async () => {
  const reply=deferred();let calls=0;
  const p=create({request:()=>{calls++;return reply.promise;},render:()=>{}});
  const a=p.reset();const b=p.load();await Promise.resolve();assert.equal(calls,1);
  reply.resolve({items:[],has_more:true,next_offset:0});await Promise.all([a,b]);assert.equal(p.hasMore(),false);
  let offset=0;const empty=create({request:async()=>({items:[],has_more:true,next_offset:++offset}),render:()=>{}});
  await empty.reset();await empty.load();await empty.load();await empty.load();assert.equal(offset,3);assert.equal(empty.hasMore(),false);
});
test('local and website batches progressively render without extra remote requests', async () => {
  let calls=0;const p=create({pageSize:2,request:async()=>{calls++;return {items:[row('a'),row('b'),row('c'),row('d'),row('e')],has_more:false};},render:()=>{}});
  await p.reset();assert.equal(p.items.length,2);await p.load();await p.load();assert.equal(p.items.length,5);assert.equal(calls,1);assert.equal(p.hasMore(),false);
  p.local([row('x'),row('y'),row('z')],2);await p.load();assert.equal(calls,1);assert.deepEqual(p.items.map(x=>x.series_id),['x','y','z']);
});
test('comments preserve opaque cursors and deduplicate precise comment IDs', async () => {
  const cursors=[];
  const p=create({key:x=>x.comment_id,cursor:d=>d.next_cursor?{cursor:d.next_cursor}:{},request:async q=>{cursors.push(q.cursor);return {items:[{comment_id:q.cursor?'7691344565400093503':'7691344565400093502'}],next_cursor:q.cursor?'page-two':'page-one',has_more:true};},render:()=>{}});
  await p.reset({vid:'7690223053078268953'});await p.load();await p.load();
  assert.deepEqual(cursors,[undefined,'page-one','page-two']);assert.equal(p.items.length,2);assert.equal(p.hasMore(),false);
});
test('feed switches from tab phase to cell phase at offset zero without stopping', async () => {
  const calls=[];
  const p=create({cursor:(d,old)=>({offset:d.next_offset||0,feed_cell:d.feed_cell||old.feed_cell||'',feed_plan:d.feed_plan||old.feed_plan||''}),request:async q=>{calls.push(q);return q.feed_cell ? {items:[row('second')],next_offset:6,has_more:false} : {items:[row('first')],next_offset:0,feed_cell:'cell',feed_plan:'plan',has_more:true};},render:()=>{}});
  await p.reset({channel:'39'});assert.equal(p.hasMore(),true);await p.load();assert.equal(calls[1].offset,0);assert.equal(calls[1].feed_cell,'cell');assert.equal(p.items.length,2);assert.equal(p.hasMore(),false);
});
test('calendar continues when released offset resets, then follows the independent upcoming cursor', async () => {
  const fs=require('node:fs'),vm=require('node:vm');
  const source=fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/app.js'),'utf8');
  const c=vm.createContext({});vm.runInContext(source.slice(source.indexOf('  function calendarCursor('),source.indexOf('  function createListPager(')),c);
  const responses=[
    {items:[row('released')],next_offset:45,has_more:true,session_id:'session'},
    {items:[row('last-released'),row('pending')],next_offset:24,next_subscribe_offset:23,has_more:true},
    {items:[row('pending'),row('pending-next')],next_offset:48,next_subscribe_offset:47,has_more:true},
    {items:[row('pending-last')],next_offset:62,next_subscribe_offset:61,has_more:false}
  ];
  const calls=[];const p=create({cursor:c.calendarCursor,request:async q=>{calls.push(q);return responses.shift()},render:()=>{}});
  await p.reset({date:'20261007'});await p.load();assert.equal(p.hasMore(),true);
  await p.load();await p.load();
  assert.deepEqual(calls.map(q=>q.subscribe_offset),[undefined,'','23','47']);
  assert.deepEqual(calls.map(q=>q.offset),[undefined,45,24,48]);
  assert.ok(calls.every(q=>q.date==='20261007'));
  assert.deepEqual(p.items.map(x=>x.series_id),['released','last-released','pending','pending-next','pending-last']);
  assert.equal(p.hasMore(),false);
});
