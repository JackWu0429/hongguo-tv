红果短剧桌面版 0.2.100（macOS / Windows）

- 修复匿名分类请求缺少签名导致的上游空响应，并为临时空响应增加重试。
- 调整宽视口下搜索联想面板的宽度，使其与搜索框和扫描按钮组成的控制区一致。
- Media3 切集时隐藏剧集海报，避免过渡中再次闪出海报；切集黑屏仍需在目标设备确认。

macOS 通用 ZIP 支持 Intel / Apple Silicon，最低 macOS 11；Windows x64 需要 Microsoft Edge WebView2 Runtime。Linux x86_64 AppImage 测试版在独立的 `linux-v0.2.100-test.1` 预发行版中提供，依赖系统 WebKitGTK 和 GStreamer。
通过设置检查更新并下载 ZIP，退出后手动替换完整程序。账号及本地记录保存在独立用户目录。
未做 Apple 公证或 Windows 代码签名。Windows 实体播放仍待实测。
