红果短剧桌面版 0.2.109（macOS / Windows）

- 本次桌面版随统一发布线更新版本号；Android TV 播放页菜单键现在兼容标准菜单键和 TV 专用菜单键，播放菜单引导文字在大视口下保持可读大小；详情弹窗演员列表的焦点环在旧版 Android WebView 上保持完整可见。

macOS 通用 ZIP 支持 Intel / Apple Silicon，最低 macOS 11；Windows x64 需要 Microsoft Edge WebView2 Runtime。Windows 播放 HEVC 还需要安装 HEVC Video Extensions；商店无法获取时，可参考 https://github.com/Ayx03/HEVCVideoExtension。Linux x86_64 AppImage 测试版在独立的 `linux-v0.2.109-test.1` 预发行版中提供，依赖系统 WebKitGTK 和 GStreamer。
通过设置检查更新并下载 ZIP，退出后手动替换完整程序。账号及本地记录保存在独立用户目录。
未做 Apple 公证或 Windows 代码签名。Windows 实体播放仍待实测。
