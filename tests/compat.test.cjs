const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const compat = fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/compat.js'), 'utf8');
function oldWebView() {
  const context = vm.createContext({setTimeout, clearTimeout});
  vm.runInContext(`
    window = this; events = {}; xhrs = [];
    window.addEventListener = function(type, callback) { events[type] = callback; };
    function Element() {
      this.nodeType = 1; this.children = []; this.scrollHeight = 0;
      this.style = {};
      Object.defineProperty(this.style, 'display', {get:function(){return ''},set:function(){}});
      Object.defineProperty(this.style, 'aspectRatio', {get:function(){return ''},set:function(){}});
      this.classList = {names:[],add:function(value){this.names.push(value)}};
    }
    Element.prototype.webkitMatchesSelector = function(selector) {return this.selector === selector};
    Element.prototype.appendChild = function(child) {this.children.push(child);child.parentNode=this;child.parentElement=this};
    Element.prototype.removeChild = function(child) {this.children.splice(this.children.indexOf(child),1)};
    Element.prototype.scrollIntoView = function(value) {this.originalScroll=value};
    function NodeList() {this[0]='first';this[1]='second';this.length=2}
    document = {documentElement:new Element(),createElement:function(){return new Element()},getElementById:function(){return null}};
    XMLHttpRequest = function() {xhrs.push(this);this.headers={}};
    XMLHttpRequest.prototype.open = function(method,url){this.method=method;this.url=url};
    XMLHttpRequest.prototype.setRequestHeader = function(key,value){this.headers[key]=value};
    XMLHttpRequest.prototype.send = function(body){this.body=body};
    XMLHttpRequest.prototype.abort = function(){this.aborted=true};
    XMLHttpRequest.prototype.respond = function(status,body){this.status=status;this.responseText=body;this.onload()};
    Object.assign=undefined;Number.isFinite=undefined;Array.from=undefined;
    URLSearchParams=undefined;AbortController=undefined;fetch=undefined;
  `, context);
  vm.runInContext(compat, context);
  return context;
}
test('Chromium 44 missing DOM/collection APIs are restored without losing Unicode', () => {
  const c=oldWebView();
  const value=vm.runInContext(`JSON.stringify({
    list:(function(){var rows=[];new NodeList().forEach(function(v){rows.push(v)});return rows})(),
    assigned:Object.assign({},null,{a:1},{b:2}), finite:[Number.isFinite(3),Number.isFinite('3'),Number.isFinite(Infinity)],
    unicode:Array.from('字😀').length, query:new URLSearchParams({q:'红果 & 剧',offset:20}).toString(),
    layout:document.documentElement.classList.names, probes:document.documentElement.children.length
  })`,c);
  const result=JSON.parse(value);
  assert.deepEqual(result.list,['first','second']);assert.deepEqual(result.assigned,{a:1,b:2});
  assert.deepEqual(result.finite,[true,false,false]);assert.equal(result.unicode,2);
  assert.equal(new URLSearchParams(result.query).get('q'),'红果 & 剧');
  assert.deepEqual(result.layout,['legacy-grid','legacy-aspect','legacy-flex-gap']);assert.equal(result.probes,0);
  assert.equal(vm.runInContext(`(function(){var parent=new Element(),child=new Element();parent.selector='.root';parent.appendChild(child);return child.closest('.root')===parent})()`,c),true);
});
test('XHR fetch preserves POST JSON, HTTP failure status and malformed JSON errors', async () => {
  const c=oldWebView();
  const response=vm.runInContext(`fetch('/api/v1/library',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"value":true}'})`,c);
  assert.equal(c.xhrs[0].method,'POST');assert.equal(c.xhrs[0].body,'{"value":true}');
  c.xhrs[0].respond(401,'{"error":"请登录"}');
  const r=await response;assert.equal(r.ok,false);assert.equal(r.status,401);assert.equal((await r.json()).error,'请登录');
  const malformed=vm.runInContext(`fetch('/api/v1/status')`,c);c.xhrs[1].respond(200,'bad json');
  await assert.rejects((await malformed).json(),{name:'SyntaxError'});
});
test('old WebView cancellation stops XHR and rejects both live and already aborted requests', async () => {
  const c=oldWebView();
  const result=vm.runInContext(`controller=new AbortController();fetch('/api/v1/series/seasons',{signal:controller.signal})`,c);
  const rejection=assert.rejects(result,{name:'AbortError'});
  c.controller.abort();await rejection;assert.equal(c.xhrs[0].aborted,true);
  const pre=vm.runInContext(`fetch('/api/v1/series/seasons',{signal:controller.signal})`,c);
  await assert.rejects(pre,{name:'AbortError'});assert.equal(c.xhrs[1].body,undefined);
});
test('network errors and timeouts reject rather than leave the interface waiting', async () => {
  const c=oldWebView();
  const network=vm.runInContext(`fetch('/api/v1/status')`,c);const failed=assert.rejects(network,{name:'TypeError'});c.xhrs[0].onerror();await failed;
  const timeout=vm.runInContext(`fetch('/api/v1/play/info')`,c);const expired=assert.rejects(timeout,{name:'TimeoutError'});c.xhrs[1].ontimeout();await expired;
});
test('compatibility bootstrap is idempotent and leaves existing APIs in place', () => {
  const c=oldWebView();
  const fetch=c.fetch, assign=vm.runInContext('Object.assign',c);
  vm.runInContext(compat,c);
  assert.equal(c.fetch,fetch);assert.equal(vm.runInContext('Object.assign',c),assign);
});
test('legacy playback utility group stays docked to the right of the controls', () => {
  const css = fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/compat.css'), 'utf8');
  assert.match(css, /\.legacy-flex-gap \.playback-buttons > \.playback-utility-group\s*\{\s*margin-left:\s*auto;/);
});
test('remote focus uses nearest scrolling rather than old boolean scrollIntoView alignment', () => {
  const c=oldWebView();
  const result=vm.runInContext(`(function(){
    window.getComputedStyle=function(){return {overflowY:'auto',overflowX:'hidden'}};
    var parent=new Element(),child=new Element();parent.parentElement=document.documentElement;
    parent.clientTop=0;parent.clientLeft=0;parent.scrollTop=20;parent.clientHeight=100;parent.scrollHeight=400;
    parent.getBoundingClientRect=function(){return {top:0,left:0}};
    child.parentElement=parent;child.getBoundingClientRect=function(){return {top:80,bottom:118,left:0,right:58}};
    child.scrollIntoView({block:'nearest'});
    var nearest=parent.scrollTop;child.scrollIntoView(false);
    return JSON.stringify({nearest:nearest,original:child.originalScroll});
  })()`,c);
  assert.deepEqual(JSON.parse(result),{nearest:38,original:false});
});
