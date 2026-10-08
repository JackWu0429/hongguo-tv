const {test}=require('node:test');
const assert=require('node:assert/strict');
const {create,normalize}=require('../core/cmd/hongguotv/ui/search-history.js');
const flush=()=>new Promise(r=>setImmediate(r));
test('text normalization allows Unicode without changing title punctuation',()=>{
  assert.equal(normalize(' \n魏家逆子  BOSS 2 & 十三季\t'),'魏家逆子 BOSS 2 & 十三季');
  for(const value of ['', ' ',null,'a'.repeat(101),'a\x00b'])assert.equal(normalize(value),'');
});
test('pending add and clear serialize so delayed reads cannot resurrect cleared history',async()=>{
  const calls=[],renders=[];let pending;
  const h=create({request:(method,query)=>{calls.push({method,query});return new Promise(resolve=>pending=resolve)},render:items=>renders.push(items)});
  const read=h.load(), add=h.add('新剧'), clear=h.clear();await flush();assert.equal(calls.length,1);
  pending({items:['旧剧']});await read;await flush();assert.equal(calls[1].method,'POST');
  pending({items:['新剧','旧剧']});await add;await flush();assert.equal(calls[2].method,'DELETE');
  pending({items:[]});assert.equal(await clear,true);assert.deepEqual(renders.at(-1),[]);
});
test('invalid and failed keyword writes do not poison later history operations',async()=>{
  const renders=[],errors=[],calls=[];
  const h=create({request:async(method,query)=>{calls.push(method);if(method==='POST')throw Error('disk');return {items:['最近','最近','  ',...Array.from({length:20},(_,i)=>String(i))]}},render:v=>renders.push(v),error:m=>errors.push(m)});
  assert.equal(await h.add(' '),false);assert.equal(calls.length,0);
  assert.equal(await h.add('剧名'),false);assert.deepEqual(errors,['POST']);
  assert.equal(await h.load(),true);assert.equal(renders[0].length,10);assert.equal(renders[0][0],'最近');
});
