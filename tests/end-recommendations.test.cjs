const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {create,itemsFor}=require('../core/cmd/hongguotv/ui/end-recommendations.js');
const source=fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/app.js'),'utf8');
const slice=(a,b)=>source.slice(source.indexOf('  function '+a+'('),source.indexOf('  function '+b+'('));
const tick=()=>new Promise(r=>setImmediate(r));
const related=Array.from({length:12},(_,i)=>({series_id:'r'+i,title:'相关推荐'+i,episode_count:10}));

test('recommendations preserve upstream order, remove the current drama/duplicates/unreleased rows and cap the list',()=>{
  const rows=itemsFor([{series_id:'self',title:'本剧'},...related,related[0],{series_id:'soon',title:'未上线',upcoming:true},{series_id:'unavailable',title:'不可播放',playable:false},{series_id:'empty'},null],'self');
  assert.deepEqual(rows,related);
  assert.equal(itemsFor(Array.from({length:40},(_,i)=>({series_id:String(i),title:'剧'})),'none').length,20);
  assert.deepEqual(itemsFor(null,'self'),[]);
});
function fixture(){
  const calls=[],playback={item:{series_id:'self'}};
  const state={current:playback,safe:true};
  const panel=create({isCurrent:p=>state.current===p,canPresent:()=>state.safe,
    show:items=>calls.push(['show',items]),hide:(restore,animate)=>calls.push(['hide',restore,animate]),play:item=>calls.push(['play',item])});
  return {panel,calls,state,playback};
}
test('an empty response never opens an empty sheet',()=>{
  const f=fixture();assert.equal(f.panel.offer(f.playback,[]),false);assert.equal(f.panel.isOpen(),false);assert.deepEqual(f.calls,[]);
});
test('reservation, other dialogs and active controls defer focus until safe, with one automatic opening per playback',()=>{
  const f=fixture();f.state.safe=false;
  f.panel.offer(f.playback,related);f.panel.flush();assert.deepEqual(f.calls,[]);
  f.state.safe=true;assert.equal(f.panel.flush(),true);assert.equal(f.panel.isOpen(),true);
  assert.equal(f.calls[0][0],'show');
  f.panel.close(true);assert.deepEqual(f.calls.at(-1),['hide',true,true]);
  assert.equal(f.panel.offer(f.playback,related),false);assert.equal(f.panel.flush(),false);assert.equal(f.calls.filter(c=>c[0]==='show').length,1);
});
test('page/account/source changes invalidate deferred offers and stale choices',()=>{
  for(const open of [false,true]){
    const f=fixture();f.state.safe=open;f.panel.offer(f.playback,related);f.state.current=null;
    if(open)assert.equal(f.panel.choose(0),false);else assert.equal(f.panel.flush(),false);
    assert.equal(f.panel.isOpen(),false);assert.equal(f.calls.filter(c=>c[0]==='play').length,0);
  }
});
test('confirming a recommendation closes the sheet before starting exactly the selected drama',()=>{
  const f=fixture();f.panel.offer(f.playback,related);f.panel.choose(4);
  assert.deepEqual(f.calls.slice(-2),[['hide',false,false],['play',related[4]]]);
  assert.equal(f.panel.choose(4),false);assert.equal(f.calls.filter(c=>c[0]==='play').length,1);
});
test('reset clears the old playback offer so the new completed drama can have its own recommendations',()=>{
  const f=fixture();f.panel.offer(f.playback,related);f.panel.reset();
  const next={item:{series_id:'new'}};f.state.current=next;
  assert.equal(f.panel.offer(next,related),true);assert.equal(f.calls.filter(c=>c[0]==='show').length,2);
});

function keysFixture(){
  const plays=[],rows=related.map((item,i)=>({id:'card-'+i,classList:{contains:n=>n==='end-recommendation-card'},closest:()=>true,click(){panel.choose(i)}}));
  const close={id:'end-recommendations-close',closest:()=>true,click(){panel.close(true)}};
  const document={activeElement:rows[0],getElementById:id=>id==='end-recommendations-track'?{children:rows}:close};
  const panel=create({isCurrent:()=>true,canPresent:()=>true,show(){},hide(){document.activeElement={id:'hero-feed-focus'}},play:item=>plays.push(item)});
  panel.offer({item:{series_id:'self'}},related);
  const c=vm.createContext({document,endRecommendations:panel,endRecommendationIndex:0,
    goFocus(node){document.activeElement=node;const index=rows.indexOf(node);if(index>=0)c.endRecommendationIndex=index}});
  vm.runInContext(source.match(/  var keyNames = \{[\s\S]*?\n  \};/)[0]+slice('normalizedKey','showNotice')+slice('handleEndRecommendationKey','canContinuePlayback'),c);
  function press(key){let prevented=0,stopped=0;c.handleKey({...key,preventDefault(){prevented++},stopPropagation(){stopped++}});assert.equal(prevented,1);assert.equal(stopped,1)}
  return {c,rows,close,panel,plays,press,document};
}
test('modern and legacy D-pad keys stay in the row, stop at edges and restore the last card from Close',()=>{
  const f=keysFixture();f.press({keyCode:37});assert.equal(f.document.activeElement,f.rows[0]);
  for(let i=0;i<20;i++)f.press({keyCode:39});assert.equal(f.document.activeElement,f.rows.at(-1));
  f.press({keyCode:19});assert.equal(f.document.activeElement,f.close);
  f.press({keyCode:20});assert.equal(f.document.activeElement,f.rows.at(-1));
  f.press({key:'Tab'});assert.equal(f.document.activeElement,f.close);
  f.press({key:'Tab'});assert.equal(f.document.activeElement,f.rows.at(-1));
  assert.deepEqual(f.plays,[]);
});
test('Enter activates once; media shortcuts and held confirmation cannot seek or replay the background',()=>{
  const f=keysFixture();
  for(const key of [' ','MediaPlayPause','MediaFastForward','MediaRewind'])f.press({key});
  f.press({keyCode:23,repeat:true});assert.deepEqual(f.plays,[]);
  f.press({keyCode:23});assert.deepEqual(f.plays,[related[0]]);
});
test('Back and native requestBack close the sheet before fullscreen or player navigation',()=>{
  for(const key of [{key:'Escape'},{keyCode:4},{key:'Backspace'}]){
    const f=keysFixture();f.press(key);assert.equal(f.panel.isOpen(),false);assert.equal(f.document.activeElement.id,'hero-feed-focus');
  }
  const f=keysFixture();vm.runInContext(slice('handleBack','handleMediaCommand'),f.c);
  assert.equal(f.c.handleBack(),true);assert.equal(f.panel.isOpen(),false);
});

async function completion({mode='player',episode=2,successor=null,relatedRows=related,incomplete=false,late=false}={}){
  const calls=[],playback={item:{series_id:'self',episode_count:2},episode,owner:1,generation:1,completed:true,started:true};
  const c=vm.createContext({Promise,Object,Array,encodeURIComponent,activePlayback:playback,feedGeneration:1,accountEpoch:1,
    continuationGeneration:0,applicationInBackground:false,seasonSwitchRequest:null,feedItems:[playback.item,{}],feedIndex:0,
    isPlaybackPage:()=>true,pageMode:()=>mode,applicationHidden:()=>false,
    getDetail:async()=>{if(late)c.activePlayback=null;return {vid_list:incomplete?['111']:['111','222'],episode_count:incomplete?8:2,related:relatedRows}},
    setPlayerStatus(){},episodeLoadingText(){return 'loading'},revealControls(){},showNotice(){},
    playFeedItem:(index,ep)=>calls.push(['play',index,ep]),refreshDetailAfterSeason(){},
    fetch:async()=>({ok:true,json:async()=>({ok:true,data:{next:null,current_season:1}})}),
    fetchData:async()=>({items:[{series_id:'self',season_index:1},...(successor?[successor]:[])]}),
    offerNextSeasonReservation:()=>calls.push(['reservation']),offerEndRecommendations:(p,d)=>calls.push(['related',p,d.related])});
  vm.runInContext(slice('canContinuePlayback','offerNextSeasonReservation'),c);
  c.continueAfterEpisode(playback);for(let i=0;i<6;i++)await tick();return {calls,c,playback};
}
test('ordinary episode continuation and a playable next season keep autoplay without a recommendation sheet',async()=>{
  assert.deepEqual((await completion({episode:1})).calls,[['play',0,2]]);
  const f=await completion({successor:{series_id:'next',season_index:2,vid:'333',episode_count:2,playable:true}});
  assert.deepEqual(f.calls,[['play',0,1]]);
});
test('terminal playback offers the current detail data, after any next-season reservation prompt',async()=>{
  const end=await completion();assert.equal(end.calls[0][0],'related');assert.equal(end.calls[0][1],end.playback);assert.equal(end.calls[0][2],related);
  const reserve=await completion({successor:{series_id:'next',season_index:2,upcoming:true,reservation_id:'book'}});
  assert.deepEqual(reserve.calls.map(c=>c[0]),['reservation','related']);
});
test('recommendation feed, incomplete season data and stale completion callbacks do not offer a row',async()=>{
  const recommend=await completion({mode:'recommend'});assert.equal(recommend.calls.filter(c=>c[0]==='related').length,0);
  for(const args of [{incomplete:true},{late:true}])assert.deepEqual((await completion(args)).calls,[]);
});
