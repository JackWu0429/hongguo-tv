const {test} = require('node:test');
const assert = require('node:assert/strict');
const {create} = require('../core/cmd/hongguotv/ui/sms-verification.js');
function fixture() {
  let time=0,id=0,timers=new Map(),requests=[],states=[];
  const manager=create({now:()=>time,setTimeout:(f,delay)=>{timers.set(++id,{f,at:time+delay});return id},clearTimeout:id=>timers.delete(id),
    request:()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});const r={promise,resolve,reject,aborted:false,abort(){this.aborted=true}};requests.push(r);return r},
    onState:s=>states.push(s),canPoll:()=>true});
  async function tick(ms){const end=time+ms;while(true){const next=[...timers].filter(([id,x])=>x.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;time=next[1].at;timers.delete(next[0]);next[1].f();await Promise.resolve();}time=end;await Promise.resolve()}
  return {manager,requests,states,tick};
}
test('preparing and scanning do not start a 90-second round or make verification requests',async()=>{
  const f=fixture();f.manager.setSession({key:'fixture',expiresAt:600000});
  await f.tick(180000);
  assert.equal(f.requests.length,0);assert.equal(f.manager.snapshot().state,'ready');
  assert.equal(f.manager.start(),true);assert.equal(f.requests.length,1);assert.equal(f.manager.snapshot().remaining,90);
});
test('90 seconds abort an outstanding round but keep the session for another query',async()=>{
  const f=fixture();f.manager.setSession({key:'fixture',expiresAt:600000});f.manager.start();
  await f.tick(90000);
  assert.equal(f.manager.snapshot().state,'timeout');assert.equal(f.requests[0].aborted,true);
  assert.equal(f.manager.start(),true);assert.equal(f.requests.length,2);
  f.requests[0].resolve({confirmed:true});await Promise.resolve();
  assert.equal(f.manager.snapshot().state,'waiting');assert.equal(f.manager.snapshot().remaining,90);
});
test('restarting queries never extends the independent session deadline',async()=>{
  const f=fixture();f.manager.setSession({key:'fixture',expiresAt:100000});f.manager.start();
  await f.tick(90000);f.manager.start();await f.tick(10000);
  assert.equal(f.manager.snapshot().state,'expired');assert.equal(f.requests[1].aborted,true);
  assert.equal(f.manager.start(),false);assert.equal(f.requests.length,2);
});
test('polls only after confirmation and stops at one round without repeating SMS sending',async()=>{
  const f=fixture();f.manager.setSession({key:'fixture',expiresAt:600000});f.manager.start();
  for(let i=0;i<30;i++){f.requests[i].resolve({active:true});await Promise.resolve();await f.tick(3000);}
  assert.equal(f.requests.length,30);assert.equal(f.manager.snapshot().state,'timeout');
});
test('cancel, background and a new challenge discard the old pending confirmation',async()=>{
  const f=fixture();f.manager.setSession({key:'one',expiresAt:600000});f.manager.start();f.manager.stop();
  assert.equal(f.requests[0].aborted,true);f.manager.setSession({key:'two',expiresAt:650000});
  f.requests[0].resolve({confirmed:true});await Promise.resolve();
  assert.equal(f.manager.snapshot().state,'ready');assert.equal(f.requests.length,1);
});
test('identical account polling does not reset the waiting timer',async()=>{
  const f=fixture();const s={key:'one',expiresAt:600000};f.manager.setSession(s);f.manager.start();await f.tick(45000);f.manager.setSession({...s});
  assert.equal(f.manager.snapshot().remaining,45);assert.equal(f.requests.length,1);
  await f.tick(45000);assert.equal(f.manager.snapshot().state,'timeout');
});
test('confirmed and failed results stop polling and never submit again automatically',async()=>{
  for(const [result,state] of [[{confirmed:true},'confirmed'],[{error:true},'error']]){
    const f=fixture();f.manager.setSession({key:'one',expiresAt:600000});f.manager.start();f.requests[0].resolve(result);await Promise.resolve();await f.tick(95000);
    assert.equal(f.manager.snapshot().state,state);assert.equal(f.requests.length,1);
  }
});
