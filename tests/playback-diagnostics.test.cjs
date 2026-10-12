const {test} = require('node:test');
const assert = require('node:assert/strict');
const diagnostics = require('../core/cmd/hongguotv/ui/playback-diagnostics.js');
function video(values={}) { return Object.assign({currentTime:8,duration:90,videoWidth:720,videoHeight:1280,readyState:4,networkState:1,paused:false,ended:false,seeking:false,muted:true,volume:1,buffered:{length:1,start:()=>0,end:()=>20},error:null},values); }
function snapshot(values={}) { return Object.assign({video:diagnostics.readVideo(video()),flags:{preparing:true,audioHeld:true,source:true},episode:8,quality:'720P',userAgent:'Mozilla/5.0 Chrome/44.0.2403.119 HongguoTV-Android',capturedAt:'12:34:56',device:{app_version:'0.2.31',version_code:33,manufacturer:'TV maker',model:'TV-9',android_version:'9',sdk:28,process_bits:32},core:{version:'0.2.31-aabbccddeeff00112233445566778899aabbccdd',arch:'arm'}},values); }
test('captures a frozen media snapshot without requiring frame APIs on old WebViews',()=>{
  const v=video(); const s=diagnostics.readVideo(v);v.currentTime=40;v.muted=false;
  assert.equal(s.position,8);assert.equal(s.muted,true);assert.equal(s.buffered,12);assert.equal(s.decoded,null);
  assert.doesNotThrow(()=>diagnostics.readVideo(video({buffered:{get length(){throw Error('unavailable')}},getVideoPlaybackQuality(){throw Error('unavailable')}})));
});
test('keeps a useful report when an old WebView has no video snapshot yet',()=>{
  const report=diagnostics.report({capturedAt:'12:34:56',episode:1,flags:{preparing:true}});
  assert.match(report.summary,/加载层仍显示|尚未设置视频源/);
  assert.ok(report.rows.length > 5);
  assert.ok(report.rows.some(row=>row.label==='视频画面'));
});
test('distinguishes missing video dimensions from a still-active loading guard and a released guard',()=>{
  const missing=snapshot({video:diagnostics.readVideo(video({videoWidth:0,videoHeight:0}))});
  assert.match(diagnostics.report(missing).summary,/尚未报告有效画面尺寸/);
  assert.match(diagnostics.report(snapshot()).summary,/尺寸已取得.*尚未解除/);
  assert.match(diagnostics.report(snapshot({flags:{source:true,videoVisible:true}})).summary,/保护已解除/);
  assert.match(diagnostics.report(snapshot({video:diagnostics.readVideo(video({error:{code:3}}))})).summary,/解码错误/);
});
test('reports running process bits independently of the OS supported ABIs and falls back to real UA engine version',()=>{
  const s=snapshot();s.device.supported_abis='arm64-v8a, armeabi-v7a';
  const r=diagnostics.report(s), rows=Object.fromEntries(r.rows.map(x=>[x.label,x.value]));
  assert.match(rows['系统 / 架构'],/32 位 \/ arm/);assert.doesNotMatch(rows['系统 / 架构'],/64 位/);
  assert.equal(rows['WebView'],'Chromium 44.0.2403.119（浏览器标识）');
  s.device.webview_version='83.0.4103.106';assert.match(diagnostics.report(s).rows.find(x=>x.label==='WebView').value,/83\.0\.4103\.106/);
});
test('never includes source URLs, account credentials, raw error messages or native identity fields',()=>{
  const s=snapshot();const secret='https://media.invalid/a.mp4?Cookie=secret&key=private';
  s.video.error={code:2,message:secret};s.video.currentSrc=secret;s.device.phone='13800000000';s.device.serial='unique-device';s.core.path=secret;s.core.error=secret;s.core.token='secret';
  const output=JSON.stringify(diagnostics.report(s));
  for(const value of [secret,'13800000000','unique-device','private','Cookie'])assert.equal(output.includes(value),false);
});
test('shows current-source HTTP failures, buffer amount and audio protection without exposing errors from another source',()=>{
  const s=snapshot();s.core.media_http_status=416;s.core.media_age_seconds=2;s.core.media_prepared=true;s.core.media_bytes=10485760;
  const rows=Object.fromEntries(diagnostics.report(s).rows.map(x=>[x.label,x.value]));
  assert.match(rows['本次请求'],/MP4 就绪 10.0 MB.*HTTP 416/);
  assert.equal(rows['最近错误'],'本机媒体 HTTP 416');assert.match(rows['声音状态'],/临时静音保护/);
  assert.match(rows['播放时钟'],/0:08 \/ 1:30.*12 秒/);
  s.core={unavailable:true};assert.match(diagnostics.report(s).rows.find(x=>x.label==='本次请求').value,/诊断读取失败/);
});
test('reports native decoder failures and codec state without exposing media URLs',()=>{
  const s=snapshot({native:{state:'error',surface:'TextureView',first_frame:false,video_mime:'video/hevc',error_kind:'decoder',error_code:4003}});
  const report=diagnostics.report(s),rows=Object.fromEntries(report.rows.map(x=>[x.label,x.value]));
  assert.match(report.summary,/Media3.*HEVC/);
  assert.match(rows.Media3,/video\/hevc.*decoder 4003.*未出首帧/);
  assert.match(rows['最近错误'],/Media3 decoder（4003）/);
  s.native.url='https://media.invalid/a.mp4?key=secret';
  assert.doesNotMatch(JSON.stringify(diagnostics.report(s)),/media\.invalid|secret/);
});
test('reports native track support separately from decoder and first-frame state',()=>{
  const s=snapshot({native:{state:'preparing',surface:'SurfaceView',first_frame:false,video_decoder:'OMX.vendor.hevc.decoder',video_mime:'video/hevc',video_track:'video/hevc [hvc1.2.4.L150.B0] · 1920x1080 · 25fps',track_support:'FORMAT_HANDLED',track_selected:'是',unselected_hevc:'1280x720=FORMAT_EXCEEDS_CAPABILITIES'}});
  const rows=Object.fromEntries(diagnostics.report(s).rows.map(x=>[x.label,x.value]));
  assert.match(rows['视频轨道'],/video\/hevc.*FORMAT_HANDLED.*已选择/);
  assert.match(rows['未选 HEVC'],/1280x720.*FORMAT_EXCEEDS_CAPABILITIES/);
  assert.match(diagnostics.report(snapshot({native:{track_support:'FORMAT_UNSUPPORTED_SUBTYPE'}})).summary,/没有接受当前视频轨道/);
});
test('MPV reports actual audio output and native surface independently of the hidden HTML video',()=>{
  const s=snapshot({flags:{source:true,videoVisible:false},native:{engine:'mpv',state:'playing',surface:'SurfaceView',output_ready:true,
    restart_seen:true,vo_configured:true,video_output:'gpu',surface_width:1280,surface_height:720,surface_attached:true,surface_visible:true,
    audio_output:'opensles',audio_codec:'aac',audio_format:'s16',audio_rate:48000,audio_channels:2,actual_mute:true,actual_volume:100,actual_pause:false,
    output_messages:'音频输出警告'}});
  s.video.muted=false;
  const rows=Object.fromEntries(diagnostics.report(s).rows.map(x=>[x.label,x.value]));
  assert.match(rows.MPV,/输出已就绪/);assert.doesNotMatch(rows.MPV,/已出首帧/);
  assert.match(rows['MPV 视频输出'],/gpu.*1280 × 720.*重启信号/);
  assert.match(rows['MPV 音频输出'],/opensles.*aac.*s16.*48000 Hz.*2 声道/);
  assert.match(rows['MPV 实际状态'],/已静音.*100%.*运行中/);
  assert.match(rows['声音状态'],/已解除静音/);
  assert.match(rows['画面保护'],/原生视频层已显示/);assert.doesNotMatch(rows['画面保护'],/视频隐藏/);
  assert.equal(rows['MPV 输出提示'],'音频输出警告');
});
test('MPV diagnostics retain signed native errors and do not invent output state from a legacy restart',()=>{
  const s=snapshot({native:{engine:'mpv',state:'error',first_frame:true,frame_signal:'playback-restart',error_kind:'media',error_code:-13}});
  const rows=Object.fromEntries(diagnostics.report(s).rows.map(x=>[x.label,x.value]));
  assert.match(rows.MPV,/输出待确认/);assert.doesNotMatch(rows.MPV,/已出首帧/);
  assert.match(rows['最近错误'],/media（-13）/);assert.match(rows['MPV 实际状态'],/状态未取得/);
  s.native.log='https://media.invalid/a.mp4?key=secret';
  assert.doesNotMatch(JSON.stringify(diagnostics.report(s)),/media\.invalid|secret/);
});
