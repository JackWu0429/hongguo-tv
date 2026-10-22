const {test} = require('node:test');
const assert = require('node:assert/strict');
const {create} = require('../core/cmd/hongguotv/ui/updates.js');

test('playback keeps update prompts disabled and does not cause repeated bridge calls', () => {
  let allowed=false; const calls=[]; const rendered=[];
  const update=create({bridge:{getStatus:()=>JSON.stringify({state:'available',latest_code:9}),setPromptAllowed:x=>calls.push(x)},canPrompt:()=>allowed,render:x=>rendered.push(x)});
  update.refresh(); update.refresh(); assert.deepEqual(calls,[false]); assert.equal(rendered.length,1);
  allowed=true; update.refresh(); assert.deepEqual(calls,[false,true]);
  allowed=false; update.refresh(); assert.deepEqual(calls,[false,true,false]);
});
test('manual checks set prompt safety before native check', () => {
  const calls=[];
  const update=create({bridge:{getStatus:()=>'{"state":"idle"}',setPromptAllowed:x=>calls.push(x),check:()=>calls.push('check')},canPrompt:()=>true,render:()=>{}});
  update.check(); assert.deepEqual(calls,[true,'check']);
});
test('the update action installs a verified APK and otherwise checks for updates', () => {
  const calls=[];
  let status={state:'ready',desktop:false};
  const update=create({bridge:{getStatus:()=>JSON.stringify(status),setPromptAllowed:()=>{},check:()=>calls.push('check'),install:()=>calls.push('install')},canPrompt:()=>true,render:()=>{}});
  update.activate();
  status={state:'available',desktop:false}; update.activate();
  status={state:'ready',desktop:true}; update.activate();
  assert.deepEqual(calls,['install','check','check']);
});
test('missing native bridge and invalid bridge data fail without breaking browsing', () => {
  const renders=[];
  const browser=create({render:x=>renders.push(x)}); browser.refresh(); browser.check();
  assert.equal(renders[0].supported,false);
  const broken=create({bridge:{getStatus:()=>'<html>proxy error</html>'},render:x=>renders.push(x),canPrompt:()=>true});
  broken.refresh(); assert.equal(renders[1].state,'error');
});
