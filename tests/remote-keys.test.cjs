const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/app.js'), 'utf8');
const keyNames = source.match(/  var keyNames = \{[\s\S]*?\n  \};/)[0];
const keys = source.slice(source.indexOf('  function normalizedKey('), source.indexOf('  function showNotice('));
function keyboard() {
  const c = vm.createContext({});
  vm.runInContext(`
    var current={id:'sidebar-recommend',classList:{contains:function(){return false}}};
    var document={activeElement:current};
    var detailModalOpen=false,playerOptionsOpen=false,confirmOpen=false,discussionOpen=false;
    var androidShell=false,accountEditingInput=null;
    function firstVisible(selector){return {id:selector.slice(1)}}
    var shell={classList:{contains:function(){return false}}};
    var moved=[],focused=[],clicks=0;
    function pageMode(){return 'search'}
    function isPlaybackPage(){return false}
    function zoneOf(){return 'sidebar'}
    function moveFrom(current,direction){moved.push(direction);return {id:direction}}
    function goFocus(target){focused.push(target.id)}
    function handleMediaCommand(){return false}
    function handleBack(){return true}
    current.click=function(){clicks++};
  ` + keyNames + keys, c);
  return c;
}
test('Android 6 DOM arrows without event.key enter the application focus router', () => {
  const c=keyboard();
  for (const keyCode of [37,38,39,40]) {
    let prevented=0,stopped=0;
    c.handleKey({keyCode,preventDefault(){prevented++},stopPropagation(){stopped++}});
    assert.equal(prevented,1);assert.equal(stopped,1);
  }
  assert.deepEqual(Array.from(c.moved),['left','up','right','down']);
  assert.deepEqual(Array.from(c.focused),['left','up','right','down']);
});
test('legacy arrow names, keyIdentifier, Unknown and numeric fallbacks are accepted', () => {
  const c=keyboard();
  for (const [event,key] of [
    [{key:'Left'},'ArrowLeft'],[{key:'Up'},'ArrowUp'],[{key:'Right'},'ArrowRight'],[{key:'Down'},'ArrowDown'],
    [{keyIdentifier:'Down',keyCode:40},'ArrowDown'],[{key:'Unidentified',keyCode:38},'ArrowUp'],
    [{key:'Unknown',keyCode:39},'ArrowRight'],[{which:37},'ArrowLeft'],
    [{keyIdentifier:'U+000D',keyCode:13},'Enter'],[{keyCode:27},'Escape'],
    [{keyCode:19},'ArrowUp'],[{keyCode:23},'Enter'],[{keyCode:66},'Enter'],
    [{key:'ArrowDown',keyCode:0},'ArrowDown'],[{key:'a',keyCode:65},'a']
  ]) assert.equal(c.normalizedKey(event),key);
});
test('old DOM Enter activates once and repeat is suppressed', () => {
  const c=keyboard();
  const event={keyCode:13,preventDefault(){},stopPropagation(){}};
  c.handleKey(event);c.handleKey({...event,repeat:true});
  assert.equal(c.clicks,1);
});
test('text editing retains native left and right keys instead of moving focus', () => {
  const c=keyboard();
  for (const id of ['search-input','account-phone','player-compose-input']) {
    vm.runInContext(`document.activeElement={id:'${id}',classList:{contains:function(name){return name==='${id==='account-phone'?'account-input':id==='player-compose-input'?'player-text-input':''}'}}}`,c);
    for (const keyCode of [37,39]) c.handleKey({keyCode,preventDefault(){assert.fail('editing key consumed')},stopPropagation(){assert.fail('editing key stopped')}});
  }
  assert.equal(c.moved.length,0);
});
test('native vertical bridge uses the existing router once and ignores text editing keys', () => {
  const c=keyboard();
  assert.equal(c.remoteKey(20,false),true);
  assert.equal(c.remoteKey(19,true),true);
  assert.equal(c.remoteKey(21,false),false);
  assert.deepEqual(Array.from(c.moved),['down','up']);
  assert.deepEqual(Array.from(c.focused),['down','up']);
});
test('Enter in account inputs focuses the explicit action without sending SMS or logging in', () => {
  const c=keyboard();
  vm.runInContext("var submissions=0;function accountSendCode(){submissions++};function accountLogin(){submissions++};var accountData=null;",c);
  for (const id of ['account-phone','account-code']) {
    vm.runInContext(`document.activeElement={id:'${id}',classList:{contains:function(name){return name==='account-input'}}}`,c);
    const e={keyCode:13,preventDefault(){},stopPropagation(){}};
    c.handleKey(e);c.handleKey({...e,repeat:true});
  }
  assert.equal(c.submissions,0);
  assert.deepEqual(Array.from(c.focused),['account-code','account-login']);
});
test('read-only Android account inputs route all arrows to navigation', () => {
  const c=keyboard();
  vm.runInContext("androidShell=true;document.activeElement={id:'account-phone',readOnly:true,classList:{contains:function(name){return name==='account-input'}}}",c);
  for (const keyCode of [37,38,39,40]) c.handleKey({keyCode,preventDefault(){},stopPropagation(){}});
  assert.deepEqual(Array.from(c.moved),['left','up','right','down']);
});
