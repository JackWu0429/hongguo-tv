const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/app.js'), 'utf8');
const editing = source.slice(source.indexOf('  function startAccountEditing('), source.indexOf('  function normalizedKey('));
const keys = source.slice(source.indexOf('  function normalizedKey('), source.indexOf('  function showNotice('));
const keyNames = source.match(/  var keyNames = \{[\s\S]*?\n  \};/)[0];
function account(phase='phone') {
  const c=vm.createContext({});
  vm.runInContext(`
    var androidShell=true,accountEditingInput=null,accountBusy=false,accountData={phase:'${phase}'};
    var started=0,finished=0,submissions=0,moved=[],timers=[],currentPage='account';
    function setTimeout(callback){timers.push(callback)}
    function flushTimers(){var pending=timers;timers=[];pending.forEach(function(callback){callback()})}
    var window={HongguoTVInput:{startAccountEditing:function(){started++},finishEditing:function(){finished++}}};
    var document={activeElement:null};
    function input(id){return {id:id,value:'',readOnly:false,disabled:false,classList:{contains:function(n){return n==='account-input'}},
      setAttribute:function(){},focus:function(){document.activeElement=this},blur:function(){if(document.activeElement===this)document.activeElement=null}}}
    var phone=input('account-phone'),code=input('account-code');
    function button(id){return {id:id,classList:{contains:function(){return false}}}}
    var send=button('account-send-code'),login=button('account-login'),sidebar=button('sidebar-account'),update=button('app-check-update');
    document.activeElement=phone;
    function firstVisible(selector){return selector==='#account-code'?accountData.phase==='code'?code:null:selector==='#account-login'?accountData.phase==='code'?login:null:selector==='#account-send-code'?send:null}
    function goFocus(target){document.activeElement=target}
    function activeSidebar(){return sidebar}
    function handleBack(){if(accountEditingInput){finishAccountEditing(true);return true}return false}
    function handleMediaCommand(){return false}
    function zoneOf(){return 'accountInputs'}
    function moveFrom(current,direction){moved.push(direction);return send}
    function pageMode(){return currentPage}
    function isPlaybackPage(){return false}
    var detailModalOpen=false,playerOptionsOpen=false,confirmOpen=false,discussionOpen=false,supportModalOpen=false;
    var shell={classList:{contains:function(){return false}}};
    function accountSendCode(){submissions++}function accountLogin(){submissions++}
  ` + keyNames + editing + keys,c);
  return c;
}
function key(c,keyCode,repeat=false){let prevented=0;c.handleKey({keyCode,repeat,preventDefault(){prevented++},stopPropagation(){}});return prevented}
test('natural phone focus keeps native confirmation and Back returns to send without submitting',()=>{
  const c=account();c.startAccountEditing(c.phone);
  assert.equal(key(c,13),0);assert.equal(key(c,13,true),0);
  assert.equal(c.started,1);assert.equal(c.phone.readOnly,false);
  c.phone.value='13800000000';key(c,27);
  assert.equal(c.phone.readOnly,false);assert.equal(c.finished,1);
  assert.equal(c.document.activeElement.id,'account-send-code');assert.equal(c.submissions,0);
});
test('closing IME while editing code focuses login and preserves its original editable connection',()=>{
  const c=account('code');c.startAccountEditing(c.code);
  c.code.value='123456';c.finishAccountEditing(true);c.finishAccountEditing(true);
  assert.equal(c.finished,1);assert.equal(c.code.readOnly,false);
  assert.equal(c.document.activeElement.id,'account-login');assert.equal(c.code.value,'123456');assert.equal(c.submissions,0);
});
test('code-phase phone stays locked and points to the code field',()=>{
  const c=account('code');c.phone.value='13800000000';c.phone.readOnly=true;key(c,13);
  assert.equal(c.started,0);assert.equal(c.phone.readOnly,true);
  assert.equal(c.document.activeElement.id,'account-code');
});
test('missing stored phone can be entered again and completion focuses code',()=>{
  const c=account('code');c.startAccountEditing(c.phone);c.phone.value='13800000000';key(c,27);
  assert.equal(c.started,1);assert.equal(c.phone.readOnly,false);
  assert.equal(c.document.activeElement.id,'account-code');
});
test('busy inputs cannot start editing and completion does not submit',()=>{
  const c=account();c.accountBusy=true;c.startAccountEditing(c.phone);key(c,13);
  assert.equal(c.started,0);assert.equal(c.phone.readOnly,false);assert.equal(c.submissions,0);
});
test('keyboard arrows, confirmation, digits and deletion remain native until returning to an action',()=>{
  const c=account();c.startAccountEditing(c.phone);
  for(const n of [37,38,39,40,13,23,66,48,49,57,8,46]) assert.equal(key(c,n),0);
  assert.equal(c.moved.length,0);assert.equal(c.finished,0);c.finishAccountEditing(true);
  key(c,39);assert.deepEqual(Array.from(c.moved),['right']);
});
test('clicking the editing input again does not restart or reset its keyboard',()=>{
  const c=account();c.startAccountEditing(c.phone);c.phone.value='138';c.startAccountEditing(c.phone);
  assert.equal(c.started,1);assert.equal(c.phone.value,'138');assert.equal(c.phone.readOnly,false);
});
test('an editing input rejects even a mistakenly forwarded native vertical key',()=>{
  const c=account();c.startAccountEditing(c.phone);
  assert.equal(c.remoteKey(19,false),false);assert.equal(c.remoteKey(20,false),false);
  assert.equal(c.moved.length,0);assert.equal(c.document.activeElement,c.phone);
  c.finishAccountEditing(true);
  assert.equal(c.remoteKey(20,false),true);assert.equal(c.document.activeElement.id,'account-send-code');
});
test('native input keys are not intercepted even before the focus bridge has marked editing',()=>{
  const c=account();
  for(const n of [37,38,39,40,13,23,66,8]) assert.equal(key(c,n),0);
  assert.equal(c.moved.length,0);assert.equal(c.submissions,0);assert.equal(c.finished,0);
});
test('IME Done blurs before native closure and default focus on update returns to the phone action',()=>{
  const c=account();c.startAccountEditing(c.phone);c.phone.value='13800000000';
  c.accountInputBlur(c.phone);c.document.activeElement=c.update;
  assert.equal(c.accountEditingInput,c.phone);
  c.flushTimers();c.finishAccountEditing(true);
  assert.equal(c.document.activeElement,c.send);assert.equal(c.finished,1);assert.equal(c.submissions,0);
});
test('code Done returns to login even when native closure arrives before the deferred blur',()=>{
  const c=account('code');c.startAccountEditing(c.code);c.code.value='012345';
  c.accountInputBlur(c.code);c.document.activeElement=c.update;c.finishAccountEditing(true);c.flushTimers();
  assert.equal(c.document.activeElement,c.login);assert.equal(c.finished,1);assert.equal(c.code.value,'012345');
});
test('explicit navigation, a new field and leaving the account page cannot be undone by old blur',()=>{
  const navigation=account();navigation.startAccountEditing(navigation.phone);navigation.accountInputBlur(navigation.phone);
  navigation.finishAccountEditing(false);navigation.document.activeElement=navigation.update;navigation.flushTimers();
  assert.equal(navigation.document.activeElement,navigation.update);
  const replacement=account('code');replacement.startAccountEditing(replacement.phone);replacement.accountInputBlur(replacement.phone);
  replacement.document.activeElement=replacement.code;replacement.startAccountEditing(replacement.code);replacement.flushTimers();
  assert.equal(replacement.document.activeElement,replacement.code);assert.equal(replacement.accountEditingInput,replacement.code);
  const away=account();away.startAccountEditing(away.phone);away.accountInputBlur(away.phone);
  away.currentPage='recommend';away.document.activeElement=away.sidebar;away.flushTimers();
  assert.equal(away.document.activeElement,away.sidebar);assert.equal(away.accountEditingInput,null);
});
