const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mediaSource,editing}=require('../core/cmd/hongguotv/ui/desktop.js');
const vm=require('node:vm'),fs=require('node:fs');
const app=fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/app.js'),'utf8');
test('desktop media alone bypasses the Wails scheme; foreign URLs are not rewritten',()=>{
 const path='/minireel-proxy/media/ab12.mp4',config={mediaBase:'http://127.0.0.1:34567'};
 assert.equal(mediaSource(path,config),config.mediaBase+path);
 for(const p of ['https://cdn.test/a.mp4','/api/v1/account','//evil.test/a.mp4','/minireel-proxy/media/../a.mp4'])assert.equal(mediaSource(p,config),p);
 assert.equal(mediaSource(path,{mediaBase:'http://evil.test'}),path);assert.equal(mediaSource(path),path);
});
test('desktop input keys preserve deletion, paste, arrows, tab, space and IME; Enter submits the right form',()=>{
 const keys=app.slice(app.indexOf('  function normalizedKey('),app.indexOf('  function showNotice('));
 const c=vm.createContext({window:{HongguoDesktopUI:{editing}},document:{activeElement:{tagName:'INPUT',id:'account-phone'}},desktopShell:true});
 vm.runInContext(`var keyNames={},numericKeypad;function accountKeypadOpen(){return false}var actions=[];function accountSendCode(){actions.push('phone')}function accountLogin(){actions.push('code')}function submitSearch(){actions.push('search')}`+keys,c);
 for(const key of ['Backspace','Delete','ArrowLeft','ArrowDown','Tab',' ','v'])c.handleKey({key,ctrlKey:key==='v',preventDefault(){assert.fail(key)},stopPropagation(){assert.fail(key)}});
 c.handleKey({key:'Enter',isComposing:true,preventDefault(){assert.fail('IME')},stopPropagation(){}});
 for(const [id,name] of [['account-phone','phone'],['account-code','code'],['search-input','search']]){c.document.activeElement.id=id;let prevented=0;c.handleKey({key:'Enter',preventDefault(){prevented++},stopPropagation(){}});assert.equal(prevented,1);assert.equal(c.actions.at(-1),name)}
});

test('desktop update bridge reads async status and calls only download/folder bindings',async()=>{
 const {createUpdateBridge}=require('../core/cmd/hongguotv/ui/desktop.js');const calls=[];
 const win={go:{main:{desktopApp:{GetUpdateStatus:async()=>JSON.stringify({desktop:true,supported:true,state:'available',latest_code:2}),CheckUpdate:async()=>calls.push('check'),DownloadUpdate:async()=>calls.push('download'),OpenUpdateFolder:async()=>calls.push('folder')}}}};
 const bridge=createUpdateBridge(win,{platform:'darwin',version:'0.2.59'});
 bridge.setPromptAllowed(false);bridge.getStatus();await new Promise(r=>setImmediate(r));assert.equal(JSON.parse(bridge.getStatus()).prompt_allowed,false);
 bridge.check();bridge.download();bridge.openFolder();await new Promise(r=>setImmediate(r));assert.deepEqual(calls,['check','download','folder']);
 bridge.setPromptAllowed(true);assert.equal(JSON.parse(bridge.getStatus()).prompt_allowed,true);
});
