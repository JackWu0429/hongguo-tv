红果短剧桌面版 0.2.98（macOS / Windows）

- 修复旧版 WebView 下的列表、榜单表格和标签间距。
- 标准播放切集时，无法取得上一帧则保留封面遮罩，减少黑屏；MPV 播放逻辑不变。
- Windows 播放 HEVC 视频需要安装系统 HEVC Video Extensions，说明已加入下载页。

macOS 通用 ZIP 支持 Intel / Apple Silicon，最低 macOS 11；Windows x64 需要 Microsoft Edge WebView2 Runtime。Linux x86_64 AppImage 测试版在独立的 `linux-v0.2.98-test.1` 预发行版中提供，依赖系统 WebKitGTK 和 GStreamer。
通过设置检查更新并下载 ZIP，退出后手动替换完整程序。账号及本地记录保存在独立用户目录。
未做 Apple 公证或 Windows 代码签名。Windows 实体播放仍待实测。
