const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {create} = require('../core/cmd/hongguotv/ui/pagination.js');
const source = fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/app.js'), 'utf8');
function entry(id,episode,total,completed,stamp=1) {return {drama:{series_id:id,episode_count:total},episode,completed,last_played_at:stamp};}
function fixture(entries) {
  const c=vm.createContext({libraryData:{entries}});
  vm.runInContext("function libraryTime(entry,kind){return entry[({history:'last_played_at',favorites:'favorite_at',likes:'liked_at'})[kind]]||0}"+source.slice(source.indexOf('  function libraryFinished('),source.indexOf('  function renderLibrary(')),c);
  return c;
}
test('Mac history marks reaching the last episode finished even without a local completed flag',()=>{
  const c=fixture([]);
  assert.equal(c.libraryFinished(entry('a',5,5,true)),true);
  assert.equal(c.libraryFinished(entry('b',5,5,false)),true);
  const cloud=entry('cloud',100,100,false);delete cloud.completed;
  assert.equal(c.libraryFinished(cloud),true);
  assert.equal(c.libraryFinished(entry('c',4,5,true)),false);
  assert.equal(c.libraryFinished(entry('d',5,0,true)),false);
  assert.equal(c.libraryFinished(entry('e',5,5,true,0)),false);
  assert.equal(c.libraryFinished({...entry('f',5,5,false),position:0,duration:10000}),true);
  assert.equal(c.libraryFinished({...entry('g',4,5,false),position:10000,duration:10000}),false);
});
test('history filters partition all saved history without losing unknown cloud progress or changing the underlying records',()=>{
  const rows=[entry('watched',5,5,true,2),entry('last-started',5,5,false,4),entry('middle-ended',4,5,true,3),entry('unknown-total',3,0,true,1),entry('never-played',1,1,true,0)];
  const before=JSON.stringify(rows),c=fixture(rows);
  assert.deepEqual(Array.from(c.visibleLibraryEntries('history','all'),e=>e.drama.series_id),['last-started','middle-ended','watched','unknown-total']);
  assert.deepEqual(Array.from(c.visibleLibraryEntries('history','finished'),e=>e.drama.series_id),['last-started','watched']);
  assert.deepEqual(Array.from(c.visibleLibraryEntries('history','unfinished'),e=>e.drama.series_id),['middle-ended','unknown-total']);
  assert.equal(JSON.stringify(rows),before);
});
test('favorites and likes never inherit history filter state',()=>{
  const rows=[{...entry('watched',5,5,true),favorite_at:2,liked_at:3},{...entry('started',1,5,false),favorite_at:3,liked_at:2}];
  const c=fixture(rows);
  assert.deepEqual(Array.from(c.visibleLibraryEntries('favorites','finished'),e=>e.drama.series_id),['started','watched']);
  assert.deepEqual(Array.from(c.visibleLibraryEntries('likes','unfinished'),e=>e.drama.series_id),['watched','started']);
});
test('filtering happens before progressive local pagination, so later records remain reachable without network requests',async()=>{
  const rows=Array.from({length:83},(_,i)=>entry(String(i+1),i%2?4:5,5,true,i+1));
  const c=fixture(rows),expected=Array.from(c.visibleLibraryEntries('history','finished'),e=>e.drama);
  const p=create({render(){},request(){throw Error('local filtering must not make a network request')}});
  p.local(expected,20);assert.equal(p.items.length,20);assert.equal(p.hasMore(),true);
  await p.load();assert.equal(p.items.length,40);await p.load();assert.equal(p.items.length,42);assert.equal(p.hasMore(),false);
  assert.deepEqual(p.items.map(e=>e.series_id),expected.map(e=>e.series_id));
});
test('filter status follows saved episode and total, while episode end or restarting the last episode does not change it',()=>{
  const row=entry('a',4,5,false),c=fixture([row]);
  assert.equal(c.visibleLibraryEntries('history','finished').length,0);
  row.episode=5;
  row.completed=true;assert.equal(c.visibleLibraryEntries('history','finished').length,1);assert.equal(c.visibleLibraryEntries('history','unfinished').length,0);
  row.completed=false;assert.equal(c.visibleLibraryEntries('history','finished').length,1);
  row.completed=true;row.drama.episode_count=6;assert.equal(c.libraryFinished(row),false);
  row.episode=1;row.completed=false;assert.equal(c.visibleLibraryEntries('history','unfinished').length,1);
});
test('history status leaves actual resume behavior and saved episode progress intact',()=>{
  const c=fixture([]);
  vm.runInContext(source.slice(source.indexOf('  function resumeEpisode('),source.indexOf('  function clockText(')),c);
  const last=entry('a',5,5,false);last.position=45;
  const before=JSON.stringify(last);
  assert.equal(c.libraryFinished(last),true);assert.equal(c.resumeEpisode(last,last.drama),5);
  assert.equal(JSON.stringify(last),before);
  last.completed=true;assert.equal(c.resumeEpisode(last,last.drama),1);
  const middle=entry('b',4,5,true);assert.equal(c.libraryFinished(middle),false);assert.equal(c.resumeEpisode(middle,middle.drama),5);
});
