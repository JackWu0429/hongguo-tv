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
- 无手机号/验证码/搜索/弹幕扫码入口，短信二次验证仅保留可选择复制的号码与内容。
  捐赠支付二维码仍是原有支付信息，不作为输入功能。
- Android 保留 TV 数字键盘和扫码输入；默认浏览器预览仍是 TV 模式。
  访问 `http://127.0.0.1:18997/?platform=desktop` 可查看桌面交互布局。
- 桌面全屏使用 Wails 窗口全屏并同步共享 CSS。视频始终等比例显示。
- 设置页显示桌面版本及下载页入口，不调用 Android APK 更新器。每天后台检查一次，支持 ghfast 优先/直连回退、手动下载 ZIP、SHA256/ZIP
  校验和打开文件夹；不自动安装或替换程序；发布通道与 Android 双版本清单完全独立。

## GitHub 构建与测试包

`.github/workflows/desktop.yml` 在 GitHub Actions 构建，源码仍是私人仓库的
`codex/dual-player-editions` 分支，不合并 main。

- macOS universal：窗口与核心均为 x86_64/arm64，ZIP 内为 .app，最低 macOS 11。
- Windows x64：ZIP 根目录为窗口 EXE、Go 核心 EXE、安装说明；核心不弹控制台。
  需要 Microsoft Edge WebView2 Runtime，缺失时引导访问微软下载页。
- push/PR 只运行验证；workflow_dispatch 成功后将两包、SHA256 文件和桌面清单作为私人
  Release 发布，再同步公共下载仓库。两平台都成功、包内容及校验和正确才发布，失败保留 draft。
- 不用 Actions artifact 分发，只在公共仓库增加 desktop-v 标签与 desktop-update.json；不修改 Android 签名或更新渠道。
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
