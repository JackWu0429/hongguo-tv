const {test} = require('node:test');
const assert = require('node:assert/strict');
const {create} = require('../core/cmd/hongguotv/ui/number-input.js');
const keypad = require('../core/cmd/hongguotv/ui/numeric-keypad.js');
function deferred(){let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j});return {promise,resolve,reject};}
const flush=()=>new Promise(r=>setImmediate(r));
function fixture(){
  let now=0;const requests=[],render=[],completed=[],timers=[];
  const scan=create({request:(method,id,kind)=>{let d=deferred();requests.push({method,id,kind,...d});return d.promise},
    render:s=>render.push(s),complete:(kind,value)=>completed.push({kind,value}),now:()=>now,
    schedule:fn=>{const timer={fn,active:true};timers.push(timer);return timer},unschedule:t=>{if(t)t.active=false}});
  return {scan,requests,render,completed,timers,advance:t=>now+=t,tick:()=>{const timer=timers.find(t=>t.active);assert.ok(timer);timer.active=false;timer.fn()}};
}
function ready(request,id='first',kind='code'){request.resolve({session:id,kind,state:'waiting',qr:'data:image/png;base64,fixture',expires_in:300});}
test('scan completes a validated field once and stops polling without sending SMS or login',async()=>{
  const f=fixture();f.scan.start('code');ready(f.requests[0]);await flush();
  f.tick();assert.equal(f.requests[1].method,'GET');
  f.requests[1].resolve({state:'completed',kind:'code',value:'012345'});await flush();
  assert.deepEqual(f.completed,[{kind:'code',value:'012345'}]);assert.equal(f.requests[2].method,'DELETE');
  assert.equal(f.timers.filter(t=>t.active).length,0);
});
test('late create after Back is cancelled and cannot resurrect a QR',async()=>{
  const f=fixture();f.scan.start('phone');f.scan.stop();ready(f.requests[0],'old','phone');await flush();
  assert.equal(f.requests[1].method,'DELETE');assert.equal(f.requests[1].id,'old');assert.equal(f.render.at(-1).state,'closed');assert.equal(f.completed.length,0);
});
test('late poll or old create cannot replace the new field or cancel its session',async()=>{
  const f=fixture();f.scan.start('phone');ready(f.requests[0],'old','phone');await flush();f.tick();
  const old=f.requests[1];f.scan.start('code');ready(f.requests[3],'new','code');await flush();
  old.resolve({state:'completed',kind:'phone',value:'13800000000'});await flush();
  assert.equal(f.completed.length,0);assert.equal(f.render.at(-1).state,'waiting');f.tick();assert.equal(f.requests.at(-1).id,'new');
});
test('manual completion and all close reasons isolate pending remote input',async()=>{
  for(const reason of ['complete','back','context','background','page']){
    const f=fixture();const closed=[];const pad=keypad.create({close:r=>{closed.push(r);f.scan.stop()}});
    pad.open('code','012345');f.scan.start('code');ready(f.requests[0]);await flush();f.tick();const pending=f.requests[1];
    pad.close(reason);pending.resolve({state:'completed',kind:'code',value:'123456'});await flush();
    assert.equal(f.completed.length,0);assert.equal(closed.length,1);
  }
});
test('offline, expiry and repeated poll failure leave numeric input available',async()=>{
  const offline=fixture();offline.scan.start('phone');offline.requests[0].reject(Error('offline'));await flush();assert.equal(offline.render.at(-1).state,'unavailable');
  const expired=fixture();expired.scan.start('code');ready(expired.requests[0]);await flush();expired.advance(300001);expired.tick();assert.equal(expired.render.at(-1).state,'unavailable');assert.equal(expired.requests[1].method,'DELETE');
  const failed=fixture();failed.scan.start('code');ready(failed.requests[0]);await flush();
  for(let i=0;i<3;i++){failed.tick();failed.requests.at(-1).reject(Error('lost'));await flush()}
  assert.equal(failed.render.at(-1).state,'unavailable');assert.equal(failed.completed.length,0);
});
test('wrong fields and invalid remote digits do not change an active numeric keyboard',()=>{
  const changes=[],closes=[];const pad=keypad.create({change:(kind,value)=>changes.push({kind,value}),close:r=>closes.push(r)});
  pad.open('code','01');
  for(const [kind,value] of [['phone','13800000000'],['code','123'],['code',123456],['code','012345678'],['code','ab1234']])assert.equal(pad.completeRemote(kind,value),false);
  assert.equal(pad.snapshot().value,'01');assert.equal(closes.length,0);
  assert.equal(pad.completeRemote('code','012345'),true);assert.deepEqual(changes,[{kind:'code',value:'012345'}]);assert.equal(closes[0].reason,'complete');
  assert.equal(pad.completeRemote('code','123456'),false);
});
