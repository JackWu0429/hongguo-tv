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
test('manual checks set prompt safety before native check and proxy changes remain native', () => {
  const calls=[];
  const update=create({bridge:{getStatus:()=>'{"state":"idle"}',setPromptAllowed:x=>calls.push(x),check:()=>calls.push('check'),configure:()=>calls.push('configure')},canPrompt:()=>true,render:()=>{}});
  update.check(); update.configure(); assert.deepEqual(calls,[true,'check','configure']);
});
test('missing native bridge and invalid bridge data fail without breaking browsing', () => {
  const renders=[];
  const browser=create({render:x=>renders.push(x)}); browser.refresh(); browser.check(); browser.configure();
  assert.equal(renders[0].supported,false);
  const broken=create({bridge:{getStatus:()=>'<html>proxy error</html>'},render:x=>renders.push(x),canPrompt:()=>true});
  broken.refresh(); assert.equal(renders[1].state,'error');
});
