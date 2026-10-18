桌面测试版，macOS 与 Windows 共用现有 Go 核心和 Web UI。

- macOS universal ZIP：Intel 和 Apple Silicon，同包包含窗口与 Go 核心；最低 macOS 11。
- Windows x64 ZIP：完整解压后打开 hongguo-desktop.exe，需要 Microsoft Edge WebView2 Runtime。
- 手机号/验证码/搜索/弹幕直接键盘输入或粘贴，无扫码输入入口。
- HTML5 播放，保留等比例显示；全屏切换、账号与本机记录保留、启动重试及退出确认。
- 本包没有 Apple 开发者签名/公证或 Windows 代码签名。macOS 仅做 ad hoc 完整性签名，系统可能阻止打开未知开发者应用。
- 首批私人测试包；系统 HEVC/HTML5 实际播放与账号登录需分别在 macOS/Windows 验收，不保证所有硬件播放能力。
- 设置中的“查看桌面版本”打开下载页；尚未启用桌面自动下载安装。Android 双版本与更新清单不变。
