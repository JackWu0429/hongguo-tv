# macOS / Windows 桌面版

桌面端与 Android 共用 `core/cmd/hongguotv` Go 核心及其嵌入 Web UI。Wails
v2.11.0 只负责窗口、全屏、启动/退出及 Go 子进程。第一阶段只用 HTML5 视频：
macOS 为系统 WKWebView，Windows 为 WebView2。桌面端不包含 MPV/Media3。

## 数据、请求与播放

- Go 核心启动在动态 loopback 端口；窗口验证该子进程的随机 instance_id 和
  精确构建版本后才进入共享页面。失败时保留三行启动页及重试按钮。
- 页面保持 Wails 的固定地址，页面/API 由同一 handler 转发到核心。转发前
  检查 Wails origin，转发后改写 loopback Host；不放宽 Go 的账号访问规则。
- 视频地址只将核心生成的 `/minireel-proxy/media/<token>.mp4` 改为该进程的
  `http://127.0.0.1:<port>`，避免用 Wails 自定义协议传输视频；API 地址不改。
- 本机数据使用系统配置目录 `HongguoDesktop`，缓存使用系统缓存目录
  `HongguoDesktop/media`。稳定 Wails origin 保存 UI 偏好；账号与观看数据在 Go。
- 退出有确认（默认取消），保存待写进度后退出；最后停止并等待子进程。
  进程也使用 parent-pid 监视，窗口异常结束时不会长驻。单实例避免重复窗口。

## 输入与平台差异

- macOS/Windows 手机号、验证码使用普通输入框；直接键盘输入、粘贴、Tab 切换，
  Enter 提交。搜索和弹幕保留普通文字输入、中文输入法和删除键。
- 鼠标悬停菜单、卡片或按钮时使用现有焦点高亮，播放按钮在图标右侧展开文字；
  悬停不执行操作、不滚动页面，也不改变输入框的真实编辑焦点。方向键从当前
  悬停项继续导航；编辑中仍保留文本按键。弹窗只允许内部高亮，关闭后恢复原焦点。
- 鼠标静止、列表滚动或内容刷新不会抢回键盘高亮。该行为仅在桌面模式启用，
  Android 和 webOS 的遥控焦点规则保持原样。
- 无手机号/验证码/搜索/弹幕扫码入口，短信二次验证仅保留可选择复制的号码与内容。
  捐赠支付二维码仍是原有支付信息，不作为输入功能。
- Android 保留 TV 数字键盘和扫码输入；默认浏览器预览仍是 TV 模式。
  访问 `http://127.0.0.1:18997/?platform=desktop` 可查看桌面交互布局。
- 桌面全屏使用 Wails 窗口全屏并同步共享 CSS。视频始终等比例显示。
- 设置页显示桌面版本及下载页入口，不调用 Android APK 更新器。每天后台检查一次，按 `gh-proxy.com`、`v4.gh-proxy.org`、`gh-proxy.org`、`ghfast.top` 顺序尝试，全部失败后直连；支持手动下载 ZIP、SHA256/ZIP
  校验和打开文件夹；不自动安装或替换程序；发布通道与 Android 双版本清单完全独立。

## GitHub 构建与测试包

`.github/workflows/desktop.yml` 在 GitHub Actions 构建。正式发布统一从正式线的
`vX.Y.Z` 标签触发；手动触发仍保留用于补发和测试。开发功能可以继续在独立分支完成，
确认后再整合到正式线并打标签。

- macOS universal：窗口与核心均为 x86_64/arm64，ZIP 内为 .app，最低 macOS 11。
- Windows x64：ZIP 根目录为窗口 EXE、Go 核心 EXE、安装说明；核心不弹控制台。
  需要 Microsoft Edge WebView2 Runtime，缺失时引导访问微软下载页。
- Windows 播放红果的 HEVC 视频需要系统 HEVC 解码扩展。优先从 Microsoft Store 安装
  Microsoft HEVC Video Extensions；若商店不可用，可参考用户提供的[第三方离线扩展仓库](https://github.com/Ayx03/HEVCVideoExtension)。
- 普通 push/PR 只运行验证；正式 `vX.Y.Z` 标签或 workflow_dispatch 会构建两包、校验
  内容并发布私人 Release，再同步公共下载仓库。两平台都成功、包内容及校验和正确才
  发布，失败保留 draft。
- 不用 Actions artifact 分发，只在公共仓库增加 desktop-v 标签与 desktop-update-v2.json；不修改 Android 签名或更新渠道。
- 无开发者证书时 macOS 只做 ad hoc 完整性签名，没有 Apple 公证；Windows
  未做代码签名。系统可能提示未知开发者。正式信任签名可后续接入 CI secrets。

## 验证边界

Go 测试覆盖账号/API 转发、外部 origin 拒绝、共享页面、Range、版本/实例匹配、
启动失败重试和真实核心生命周期。共享 JS 回归覆盖 TV 旧行为与桌面编辑按键。
浏览器 fixture 验证直接登录输入、删除/Tab/Enter、扫码隐藏及请求体。

这些检查不证明实体 Windows HEVC 能力或所有 macOS 版本的 HTML5 解码能力。
桌面首次安装后仍需实测真实红果登录、连续切集、全屏与 HEVC 视频画面/声音。
参考已分析的 Mac 应用记录见 `docs/hongguo-macos-v1.1.8-analysis.md`，不把其无源码
二进制的播放实现当成当前应用的实测证据。

## 0.2.63 桌面版本

桌面版本独立于 Android APK 版本。`0.2.63` 同步共享 Web UI 的播放焦点和切集行为；macOS/Windows 仍使用各自系统 WebView 和普通键盘输入，不启用 Android 的扫码/系统输入法桥接。

## 0.2.62 桌面名称迁移

macOS bundle 目录及 Windows 启动程序分别为 `红果短剧.app` / `红果短剧.exe`。只设置 CFBundleDisplayName 不保证 Finder/Launchpad 显示中文。0.2.59/0.2.60 更新器校验英文目录，因此旧 `desktop-update.json` 保持在 0.2.60；需手动下载一次 0.2.62，随后使用 `desktop-update-v2.json`。bundle ID、应用单实例标识、数据目录和账号/history 契约不变。
