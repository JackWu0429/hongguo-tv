# MPV 输出接入修正（v0.2.48 / v0.2.49）

## 问题与证据

v0.2.47 的 Shield TV 反馈为黑屏、无声音、进度变化。原诊断只检查播放重启与视频尺寸，不能证明物理画面或声音已经输出。

使用完整生产 CSS 的隔离浏览器验证发现：`.hero.is-feed .hero-media` 的黑色背景优先级高于原生播放的透明规则，推荐页仍绘制黑色背景，遮住 WebView 后的原生 SurfaceView。v0.2.48 修正推荐页；交付复查使用实际全屏类 `.app-shell.is-cinema` 时又确认全屏 `.hero` 存在同样的覆盖，v0.2.49 补齐该规则。修正后推荐页、详情和全屏的原生视频区域透明；WebView 路径保留黑底，准备播放的过渡层仍在加载时显示并在结束后隐藏。

## 接入变化

- SurfaceHolder 的初始及变化尺寸通过 `android-surface-size` 传入 MPV；绑定 Surface 后启用 `force-window`。参考 mpv-android 的 BaseMPVView。
- 就绪条件同时要求文件已加载、有效且已绑定的 Surface、非零窗口及视频尺寸、`current-vo=gpu`、`vo-configured` 与播放重启事件；不将其称为物理首帧回调。
- 音频优先 OpenSL ES，参考 media_kit 在真实 Android 设备上的实现；AudioTrack 为初始化回退并禁用浮点 PCM。这是兼容性调整，无法据现有截图确认原声音问题的唯一原因。
- 诊断读取 MPV 的实际静音、音量、暂停、音频输出及格式。原生层显示情况不再从故意隐藏的 HTML video 推断。
- MPV 输出/解码警告仅保留固定分类与严重性，不把原始日志、媒体地址或签名参数传入页面；END_FILE 保留原生结束原因与有符号错误码。

标准版播放器的选路与回退不变。MPV 版不回退到标准版。

## 验证边界

本地验证：165 项 JavaScript 测试、23 项 Python 测试、Go race/vet、TV 架构校验、JavaScript 语法和实际 CSS 浏览器验证通过。MPV 就绪条件与警告聚合的 Java 单元测试交由 GitHub Actions，Android/Go JNI 及三架构 APK 仅在 GitHub 编译。

这些检查不证明 Shield TV 已实际显示画面、发出声音或音画同步；正式签名包仍需设备复测。

参考版本：mpv `78d43740f52db817d98bcf24fb30a76ab6fa13ff`，media-kit libmpv 构建器 `1ecf5100ec0f75e1d0630f48851b85769c92eed2`。
