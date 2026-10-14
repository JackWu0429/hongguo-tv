(function (root) {
  'use strict';
  var readyNames = ['无媒体数据', '仅元数据', '已有当前帧', '可继续播放', '数据充足'];
  var networkNames = ['未初始化', '空闲', '加载中', '无可用源'];
  var errorNames = ['未报告视频错误', '播放已中止', '媒体网络错误', '媒体解码错误', '媒体格式不支持'];
  function text(value, limit) {
    return typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, limit || 90) : '';
  }
  function num(value) { return typeof value === 'number' && isFinite(value) ? Math.max(0, value) : 0; }
  function errorCode(value) { return typeof value === 'number' && isFinite(value) ? Math.round(value) : 0; }
  function metric(value) { return typeof value === 'number' && isFinite(value) && value >= 0 ? Math.floor(value) : '未取得'; }
  function clock(value) {
    var seconds = Math.floor(num(value));
    return Math.floor(seconds / 60) + ':' + ('0' + seconds % 60).slice(-2);
  }
  function readVideo(video) {
    var result = { position: num(video.currentTime), duration: num(video.duration), width: num(video.videoWidth),
      height: num(video.videoHeight), ready: num(video.readyState), network: num(video.networkState),
      paused: !!video.paused, ended: !!video.ended, seeking: !!video.seeking, muted: !!video.muted,
      volume: num(video.volume), buffered: 0, error: video.error ? num(video.error.code) : 0, decoded: null };
    try {
      for (var i = 0; i < video.buffered.length; i++) {
        if (video.buffered.start(i) <= result.position && video.buffered.end(i) >= result.position) {
          result.buffered = video.buffered.end(i) - result.position; break;
        }
      }
    } catch (ignored) { /* Optional legacy media properties. */ }
    try {
      if (typeof video.getVideoPlaybackQuality === 'function') {
        var quality = video.getVideoPlaybackQuality();
        // totalVideoFrames includes dropped frames, so label it as frames reported.
        if (typeof quality.totalVideoFrames === 'number') result.decoded = num(quality.totalVideoFrames);
      } else if (typeof video.webkitDecodedFrameCount === 'number') result.decoded = num(video.webkitDecodedFrameCount);
    } catch (ignoredFrames) { /* Not available on all TV WebViews. */ }
    return result;
  }
  function report(snapshot) {
    snapshot = snapshot || {};
    var device = snapshot.device || {}, core = snapshot.core || {}, video = snapshot.video || { position: 0, duration: 0, width: 0, height: 0, ready: 0, network: 0, paused: true, ended: false, seeking: false, muted: true, volume: 0, buffered: 0, error: 0, decoded: null }, native = snapshot.native || {}, flags = snapshot.flags || {};
    var engine = /(?:Chrome|Chromium)\/([\d.]+)/.exec(snapshot.userAgent || '');
    var android = /HongguoTV-Android/.test(snapshot.userAgent || '');
    var bits = device.process_bits === 32 || device.process_bits === 64 ? device.process_bits + ' 位' : '位数未知';
    var arch = text(core.arch, 16), app = text(device.app_version, 36) || (android ? '应用版本未取得' : '桌面预览');
    var version = text(core.version || device.core_version, 55).replace(/([a-f0-9]{7})[a-f0-9]{20,}/g, '$1');
    var provider = text(device.webview_version, 28), engineVersion = engine ? engine[1] : '未知';
    var webview = provider ? provider + ' · Chromium ' + engineVersion : 'Chromium ' + engineVersion + '（浏览器标识）';
    var rows = [], summary;
    function add(label, value) { rows.push({ label: label, value: value }); }
    var playerName = native.engine === 'mpv' ? 'MPV' : 'Media3';
    if (native.error_kind === 'decoder') summary = playerName + ' 无法解码当前' + (native.video_mime === 'video/hevc' ? ' HEVC ' : '') + '视频；请结合设备现象判断';
    else if (native.track_support === 'FORMAT_UNSUPPORTED_SUBTYPE' || native.track_support === 'FORMAT_UNSUPPORTED_TYPE') summary = '设备没有接受当前视频轨道的编码格式';
    else if (native.track_support === 'FORMAT_EXCEEDS_CAPABILITIES') summary = '当前视频轨道超过设备的解码能力';
    else if (native.error_kind === 'network') summary = playerName + ' 读取视频数据失败';
    else if (video.error) summary = errorNames[video.error] || '播放器报告错误';
    else if (flags.failed) summary = '播放未能完成准备；请查看本次请求和最近错误';
    else if (flags.preparing && !video.width) summary = '加载层仍显示，视频尚未报告有效画面尺寸';
    else if (flags.preparing) summary = '视频尺寸已取得，加载保护尚未解除';
    else if (flags.source) summary = '加载保护已解除；实际画面和声音请结合设备现象判断';
    else summary = '尚未设置视频源，正在准备或尚未开始播放';
    add('应用版本', app + (device.version_code ? ' / ' + num(device.version_code) : ''));
    add('内置核心', version || (core.unavailable ? '诊断读取失败' : '正在读取…'));
    add('设备型号', text(device.manufacturer, 28) + ' ' + text(device.model, 52) || '浏览器预览');
    if (!device.model) rows[2].value = android ? '设备信息未取得' : '浏览器预览';
    add('系统 / 架构', device.sdk ? 'Android ' + text(device.android_version, 20) + ' / API ' + num(device.sdk) + ' · ' + bits + (arch ? ' / ' + arch : '') : (android ? 'Android · 位数未知' : '桌面浏览器') + (arch ? ' / ' + arch : ''));
    rows = rows.concat(snapshot.environmentRows || []);
    add('WebView', webview);
    add('当前视频', snapshot.episode > 0 ? '第 ' + num(snapshot.episode) + ' 集 · ' + (text(snapshot.quality, 20) || '自动') : '集数尚未确定');
    add('视频画面', video.width + ' × ' + video.height + (video.decoded !== null ? ' · 帧计数 ' + video.decoded : ' · 帧计数不可用'));
    add('播放时钟', clock(video.position) + ' / ' + (video.duration ? clock(video.duration) : '未知时长') + ' · 已缓冲 ' + Math.floor(video.buffered) + ' 秒');
    add('媒体状态', 'R' + video.ready + ' ' + (readyNames[video.ready] || '未知') + ' / N' + video.network + ' ' + (networkNames[video.network] || '未知'));
    add('播放状态', (video.ended ? '已结束' : video.paused ? '暂停' : '播放中') + (video.seeking ? ' · 定位中' : '') + (flags.background ? ' · 后台' : ''));
    if (flags.rangeRequested || flags.playbackMode) add('读取模式', (flags.rangeRequested ? 'WebView 自动按需读取' : '标准播放') + (flags.playbackMode ? ' · 当前源：' + text(flags.playbackMode, 12) : ''));
    if (flags.rangeFallback) add('播放回退', text(flags.rangeFallback, 72));
    if (native.state || native.surface || native.error_kind) {
      var nativeState = text(native.state, 24) || '未知';
      var nativeCodec = [text(native.video_decoder, 48), text(native.video_mime, 32)].filter(Boolean).join(' / ');
      var nativeError = native.error_kind ? ' · ' + text(native.error_kind, 24) + (errorCode(native.error_code) ? ' ' + errorCode(native.error_code) : '') : '';
      var frameState = native.engine === 'mpv' ? (native.output_ready ? ' · 输出已就绪' : ' · 输出待确认') : (native.first_frame ? ' · 已出首帧' : ' · 未出首帧');
      add(playerName, nativeState + (native.surface ? ' · ' + text(native.surface, 20) : '') + (nativeCodec ? ' · ' + nativeCodec : '') + nativeError + frameState);
      if (native.engine === 'mpv') {
        add('MPV 视频输出', (text(native.video_output, 20) || '未取得') + ' · ' + (native.vo_configured ? '已配置' : '未配置') +
          ' · 窗口 ' + num(native.surface_width) + ' × ' + num(native.surface_height) + ' · ' + (native.restart_seen ? '已收到重启信号' : '等待重启信号'));
        var audio = (text(native.audio_output, 20) || '输出未取得') + (native.audio_codec ? ' · ' + text(native.audio_codec, 32) : '') +
          (native.audio_format ? ' · ' + text(native.audio_format, 16) : '') + (native.audio_rate ? ' · ' + num(native.audio_rate) + ' Hz' : '') +
          (native.audio_channels ? ' · ' + num(native.audio_channels) + ' 声道' : '');
        add('MPV 音频输出', audio);
        add('MPV 实际状态', (typeof native.actual_mute === 'boolean' ? (native.actual_mute ? '已静音' : '未静音') : '静音状态未取得') +
          (typeof native.actual_volume === 'number' ? ' · 音量 ' + Math.round(num(native.actual_volume)) + '%' : '') +
          (typeof native.actual_pause === 'boolean' ? (native.actual_pause ? ' · 暂停' : ' · 运行中') : ''));
        var requested = native.mode === 'mpv_auto' ? '自动解码' : native.mode === 'mpv_software' || native.mode === 'software' ? '软件解码' : '模式未取得';
        var actual = text(native.hwdec_current, 32);
        add('MPV 解码', requested + ' · 实际：' + (actual === 'no' ? '软件解码' : actual ? actual : '未取得') + ' · 输出就绪不等同于实机画面可见');
        add('MPV 掉帧', '解码 ' + metric(native.decoder_frame_drop_count) + ' · 渲染 ' + metric(native.frame_drop_count));
        if (typeof native.demuxer_cache_duration === 'number' && isFinite(native.demuxer_cache_duration) && native.demuxer_cache_duration >= 0)
          add('MPV 缓存时长', clock(native.demuxer_cache_duration));
        if (typeof native.avsync === 'number' && isFinite(native.avsync)) add('MPV 音画差值', Math.round(native.avsync * 1000) + ' ms');
        if (native.output_messages) add('MPV 输出提示', text(native.output_messages, 90));
      }
    }
    if (native.video_track || native.track_support || native.track_selected) {
      var track = text(native.video_track, 120) || '未取得';
      if (native.track_support) track += ' · ' + text(native.track_support, 42);
      if (native.track_selected) track += ' · 已选择' + (native.track_selected === '否' ? '：否' : '');
      add('视频轨道', track);
      if (native.unselected_hevc) add('未选 HEVC', text(native.unselected_hevc, 220));
    }
    var visibility = native.engine === 'mpv' ? ' · 原生视频层' +
      (typeof native.surface_visible === 'boolean' ? (native.surface_visible && native.surface_attached ? '已显示' : '未显示') : '待确认') :
      ' · 视频' + (flags.videoVisible ? '可见' : '隐藏');
    add('画面保护', (flags.loading || flags.preparing ? '加载层显示' : '加载层已撤下') + visibility + (flags.waiting ? ' · 等待数据' : ''));
    add('声音状态', (flags.audioHeld ? '临时静音保护' : video.muted || !video.volume ? '播放器静音' : '已解除静音') + ' · 应用音量 ' + Math.round(video.volume * 100) + '%');
    var request = flags.failed ? '准备失败' : flags.source ? '播放源已返回' : flags.resolving ? '正在准备播放源' : '未开始请求';
    if (flags.source && core.media_prepared) request += core.media_mode === 'range' ? ' · Range 索引就绪 ' + (num(core.media_bytes) / 1024).toFixed(0) + ' KB' : ' · MP4 就绪 ' + (num(core.media_bytes) / 1048576).toFixed(1) + ' MB';
    request += flags.source && core.media_http_status ? ' · HTTP ' + num(core.media_http_status) + '（' + num(core.media_age_seconds) + '秒前）' : core.unavailable ? ' · 核心诊断读取失败' : ' · 尚无媒体请求记录';
    add('本次请求', request);
    add('最近错误', native.error_kind ? playerName + ' ' + text(native.error_kind, 24) + (errorCode(native.error_code) ? '（' + errorCode(native.error_code) + '）' : '') : video.error ? (errorNames[video.error] || '未知媒体错误') + '（' + video.error + '）' : flags.failed ? '播放准备失败（重试按钮已显示）' : flags.source && core.media_http_status >= 400 ? '本机媒体 HTTP ' + num(core.media_http_status) : '未报告播放错误');
    return { summary: summary, rows: rows, capturedAt: snapshot.capturedAt };
  }
  var api = { readVideo: readVideo, report: report };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HongguoPlaybackDiagnostics = api;
}(this));
