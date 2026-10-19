# Linux AppImage 实验包

此阶段验证同一个 x86_64 AppImage 在 Ubuntu 24.04 和 Debian 12 中运行、连接真实红果数据并播放 HEVC 视频。验证完成前不代表已经支持这些系统；结果记录在本文后续更新中。

## 包含内容和运行依赖

AppImage 包含桌面窗口、Go 核心及共享页面。它依赖系统的 WebKitGTK 4.1、GTK 3、GStreamer 和 HEVC/AAC 解码插件，不是免运行库的通用包。没有混入另一套 GTK/GLib/WebKit，也没有关闭 WebKit 沙箱。

Ubuntu 24.04 / Debian 12 的运行依赖：

```sh
sudo apt-get install libwebkit2gtk-4.1-0 gstreamer1.0-libav gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-pulseaudio fonts-noto-cjk
```

赋予 AppImage 执行权限后运行。如果系统缺少 FUSE，可以使用运行时提供的解包运行模式：

```sh
chmod +x hongguo-desktop-*-x86_64.AppImage
./hongguo-desktop-版本号-x86_64.AppImage --appimage-extract-and-run
```

Linux 实验包不接入 macOS / Windows 的 ZIP 更新通道。账号、记录、缓存仍使用独立用户目录，替换 AppImage 不需要移动数据。

## 构建与验证

手动触发 `Linux AppImage experiment`。在 Debian 12 内编译，生成一个 AppImage；Ubuntu 24.04 与 Debian 12 两个测试环境接收同一文件并校验 SHA256。

实际包具有明确启用的 `--linux-playback-self-test` 诊断模式，供开发测试使用。常规运行不载入诊断脚本或注册诊断桥。测试模式复用正式窗口配置、核心启动、Linux 媒体策略和关闭清理，使用临时访客目录，测试真实视频的画面、音频解码、进度、拖动和切集。AppImage 检查要求首播不借助模拟播放按键，并要求 Linux 更新通道保持关闭。

CI 中的候选包 artifact 仅用于两个测试任务间传递，保留 1 天，不是公开下载渠道。正式公开发版需要另行请求，并在全部验证通过后发布实验 Release。当前不更改 Android / macOS / Windows / webOS 的发布流程和版本号。

容器验证使用 Xvfb 和软件解码，不能证明实体显卡、Wayland、扬声器、1080p 或其他发行版的表现。容器的 namespace 配置仅用于允许 WebKit 正常创建沙箱子进程，不是关闭 WebKit 沙箱。
