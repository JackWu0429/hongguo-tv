红果短剧桌面版 0.2.60

- macOS / Windows 共用 Go 核心和页面，手机号、验证码、搜索、弹幕直接键盘输入或粘贴。
- 应用显示名称统一为“红果短剧”；内部启动文件名保持稳定，以兼容已有桌面 ZIP 更新。
- 设置 → 版本更新：每天后台检查一次，播放时不弹出提醒；支持下载更新 ZIP、显示进度、校验 SHA256 和压缩包完整性、打开下载文件夹。
- 默认通过 ghfast 检查和下载，失败时尝试直连。桌面版更新通道独立于 Android APK。
- 下载后请退出应用，自行解压替换程序。macOS 替换 .app；Windows 替换整个程序文件夹，保留窗口与核心 EXE 在同一目录。账号、历史和设置保存在独立数据目录，替换程序会保留这些数据。
- macOS universal ZIP 支持 Intel / Apple Silicon，最低 macOS 11；Windows x64 ZIP 支持 Intel / AMD 64 位处理器，需要 Microsoft Edge WebView2 Runtime。
- 桌面版只使用系统 HTML5 播放，HEVC 能力取决于系统和硬件；Windows 真实设备播放仍待实测。
- 没有 Apple 开发者签名/公证或 Windows 代码签名，系统可能提示未知开发者。
