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
    var androidShell=false; function accountKeypadOpen(){return false}
    function firstVisible(selector){return {id:selector.slice(1)}}
    var shell={classList:{contains:function(){return false}}};
    var moved=[],focused=[],clicks=0,backs=0,searches=0;
    function pageMode(){return 'search'}
    function isPlaybackPage(){return false}
    function zoneOf(){return 'sidebar'}
    function moveFrom(current,direction){moved.push(direction);return {id:direction}}
    function goFocus(target){focused.push(target.id)}
    function handleMediaCommand(){return false}
    function handleBack(){backs++;return true}
    function submitSearch(){searches++}
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
  for (const id of ['search-input','player-compose-input']) {
    vm.runInContext(`document.activeElement={id:'${id}',classList:{contains:function(name){return name==='${id==='account-phone'?'account-input':id==='player-compose-input'?'player-text-input':''}'}}}`,c);
    for (const keyCode of [37,39]) c.handleKey({keyCode,preventDefault(){assert.fail('editing key consumed')},stopPropagation(){assert.fail('editing key stopped')}});
  }
  assert.equal(c.moved.length,0);
});
test('search deletion stays native for modern and legacy keys, including held Backspace', () => {
  const c=keyboard();c.document.activeElement.id='search-input';
  for(const event of [{key:'Backspace'},{keyIdentifier:'U+0008',keyCode:8},{key:'Unknown',keyCode:8},{which:8},{keyCode:8,repeat:true},{key:'Delete'},{keyCode:46}]) {
    c.handleKey({...event,preventDefault(){assert.fail('editing key consumed')},stopPropagation(){assert.fail('editing key stopped')}});
  }
  assert.equal(c.backs,0);assert.equal(c.moved.length,0);assert.equal(c.focused.length,0);assert.equal(c.searches,0);
});
test('application Backspace outside search and Escape inside search retain back navigation', () => {
  const c=keyboard();let prevented=0,stopped=0;
  const event={preventDefault(){prevented++},stopPropagation(){stopped++}};
  c.handleKey({...event,keyCode:8});c.document.activeElement.id='search-input';c.handleKey({...event,keyCode:27});
  assert.equal(c.backs,2);assert.equal(prevented,2);assert.equal(stopped,2);
});
test('search Enter still submits once while up/down retain focus navigation', () => {
  const c=keyboard();c.document.activeElement.id='search-input';
  const event={preventDefault(){},stopPropagation(){}};
  c.handleKey({...event,keyCode:13});c.handleKey({...event,keyCode:13,repeat:true});
  c.handleKey({...event,keyCode:38});c.handleKey({...event,keyCode:40});
  assert.equal(c.searches,1);assert.deepEqual(Array.from(c.moved),['up','down']);assert.equal(c.backs,0);
});
test('native vertical bridge uses the existing router once and ignores text editing keys', () => {
  const c=keyboard();
  assert.equal(c.remoteKey(20,false),true);
  assert.equal(c.remoteKey(19,true),true);
  assert.equal(c.remoteKey(21,false),false);
  assert.deepEqual(Array.from(c.moved),['down','up']);
  assert.deepEqual(Array.from(c.focused),['down','up']);
});
test('account number buttons activate once without submitting SMS or login', () => {
  const c=keyboard();
  vm.runInContext("var submissions=0;function accountSendCode(){submissions++};function accountLogin(){submissions++};",c);
  for (const id of ['account-phone','account-code']) {
    vm.runInContext(`document.activeElement={id:'${id}',click:function(){clicks++},classList:{contains:function(name){return name==='account-input'}}}`,c);
    const e={keyCode:13,preventDefault(){},stopPropagation(){}};
    c.handleKey(e);c.handleKey({...e,repeat:true});
  }
  assert.equal(c.submissions,0);assert.equal(c.clicks,2);assert.equal(c.focused.length,0);
});
test('Android account number buttons route all arrows to navigation', () => {
  const c=keyboard();
  vm.runInContext("androidShell=true;document.activeElement={id:'account-phone',classList:{contains:function(name){return name==='account-input'}}}",c);
  for (const keyCode of [37,38,39,40]) c.handleKey({keyCode,preventDefault(){},stopPropagation(){}});
  assert.deepEqual(Array.from(c.moved),['left','up','right','down']);
});
