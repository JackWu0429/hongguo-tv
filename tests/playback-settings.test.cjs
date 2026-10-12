const {test} = require('node:test');
const assert = require('node:assert/strict');
const {create} = require('../core/cmd/hongguotv/ui/playback-settings.js');

function fixture(engine='mpv', initial='mpv_auto') {
  let stored=initial; const writes=[], states=[];
  const bridge={engine:()=>engine,decoderMode:()=>stored,setDecoderMode:value=>{stored=value;writes.push(value)}};
  return {bridge,writes,states,settings:create({bridge,render:state=>states.push(state)})};
}
test('only MPV exposes decoding settings; browser and standard playback never receive preference writes',()=>{
  for (const engine of ['webview_media3','']) {
    const f=fixture(engine);assert.equal(f.states[0].supported,false);
    assert.equal(f.settings.choose('mpv_software'),false);assert.deepEqual(f.writes,[]);
  }
  const states=[];create({render:s=>states.push(s)});assert.equal(states[0].supported,false);
});
test('selection is saved through native preferences and survives recreating the settings controller',()=>{
  const f=fixture();assert.equal(f.states[0].mode,'mpv_auto');
  assert.equal(f.settings.choose('mpv_software'),true);
  assert.match(f.states.at(-1).message,/下次播放或切集/);
  const restored=[];create({bridge:f.bridge,render:s=>restored.push(s)});
  assert.equal(restored[0].mode,'mpv_software');
  assert.equal(f.settings.choose('mpv_auto'),true);
  assert.deepEqual(f.writes,['mpv_software','mpv_auto']);
  assert.equal(f.settings.choose('mediacodec'),false);
});
test('a rejected or unavailable preference does not report successful saving',()=>{
  const f=fixture();f.bridge.setDecoderMode=()=>{};
  assert.equal(f.settings.choose('mpv_software'),false);
  assert.equal(f.states.at(-1).mode,'mpv_auto');assert.match(f.states.at(-1).message,/未能保存/);
  f.bridge.setDecoderMode=()=>{throw Error('bridge disconnected')};
  assert.equal(f.settings.choose('mpv_software'),false);
});
