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
    var started=0,finished=0,submissions=0,moved=[];
    var window={HongguoTVInput:{startAccountEditing:function(){started++},finishEditing:function(){finished++}}};
    var document={activeElement:null};
    function input(id){return {id:id,value:'',readOnly:true,disabled:false,classList:{contains:function(n){return n==='account-input'}},
      setAttribute:function(){},focus:function(){document.activeElement=this},blur:function(){document.activeElement=null}}}
    var phone=input('account-phone'),code=input('account-code');
    var send={id:'account-send-code'},login={id:'account-login'},sidebar={id:'sidebar-account'};
    document.activeElement=phone;
    function firstVisible(selector){return selector==='#account-code'?accountData.phase==='code'?code:null:selector==='#account-login'?accountData.phase==='code'?login:null:selector==='#account-send-code'?send:null}
    function goFocus(target){document.activeElement=target}
    function activeSidebar(){return sidebar}
    function handleBack(){if(accountEditingInput){finishAccountEditing(true);return true}return false}
    function handleMediaCommand(){return false}
    function zoneOf(){return 'accountInputs'}
    function moveFrom(current,direction){moved.push(direction);return send}
    function pageMode(){return 'account'}
    function isPlaybackPage(){return false}
    var detailModalOpen=false,playerOptionsOpen=false,confirmOpen=false,discussionOpen=false;
    var shell={classList:{contains:function(){return false}}};
    function accountSendCode(){submissions++}function accountLogin(){submissions++}
  ` + keyNames + editing + keys,c);
  return c;
}
function key(c,keyCode,repeat=false){c.handleKey({keyCode,repeat,preventDefault(){},stopPropagation(){}})}
test('confirm edits phone, Back completes and focuses send without submitting',()=>{
  const c=account();key(c,13);key(c,13,true);
  assert.equal(c.started,1);assert.equal(c.phone.readOnly,false);
  c.phone.value='13800000000';key(c,27);
  assert.equal(c.phone.readOnly,true);assert.equal(c.finished,1);
  assert.equal(c.document.activeElement.id,'account-send-code');assert.equal(c.submissions,0);
});
test('closing IME while editing code restores read-only navigation and login action',()=>{
  const c=account('code');c.startAccountEditing(c.code);
  c.code.value='123456';c.finishAccountEditing(true);c.finishAccountEditing(true);
  assert.equal(c.finished,1);assert.equal(c.code.readOnly,true);
  assert.equal(c.document.activeElement.id,'account-login');assert.equal(c.code.value,'123456');assert.equal(c.submissions,0);
});
test('code-phase phone stays locked and points to the code field',()=>{
  const c=account('code');c.phone.value='13800000000';key(c,13);
  assert.equal(c.started,0);assert.equal(c.phone.readOnly,true);
  assert.equal(c.document.activeElement.id,'account-code');
});
test('missing stored phone can be entered again and completion focuses code',()=>{
  const c=account('code');key(c,13);c.phone.value='13800000000';key(c,13);
  assert.equal(c.started,1);assert.equal(c.phone.readOnly,true);
  assert.equal(c.document.activeElement.id,'account-code');
});
test('busy inputs cannot start editing and completion does not submit',()=>{
  const c=account();c.accountBusy=true;key(c,13);
  assert.equal(c.started,0);assert.equal(c.phone.readOnly,true);assert.equal(c.submissions,0);
});
test('editing retains caret keys, after finishing the same keys navigate',()=>{
  const c=account();key(c,13);key(c,37);key(c,38);key(c,39);key(c,40);
  assert.equal(c.moved.length,0);c.finishAccountEditing(false);c.document.activeElement=c.phone;
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
  c.finishAccountEditing(false);c.document.activeElement=c.phone;
  assert.equal(c.remoteKey(20,false),true);assert.equal(c.document.activeElement.id,'account-send-code');
});
