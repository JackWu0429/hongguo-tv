# MiniReel MPV 播放配置对照（2026-10-12）

用户反馈：红果 MPV 版 v0.2.48 已有声音与画面，但播放略卡。此次核对 MiniReel 的源码和锁定依赖，未修改红果的解码策略。v0.2.49 只补齐全屏透明规则，也没有性能调整。

## 证据与版本

- MiniReel 源码：[cartawi/minireel，提交 3f4b839](https://github.com/cartawi/minireel/tree/3f4b83949b1b9aa1ea24239c2a3abf9ab511b10a)。本地证据目录 `/tmp/minireel-src.iku34x`。
- [播放器实现](https://github.com/cartawi/minireel/blob/3f4b83949b1b9aa1ea24239c2a3abf9ab511b10a/lib/playback/media_kit_engine.dart) 创建 `VideoController(player)`，没有覆盖 `hwdec`。
- `pubspec.lock` 固定 `media_kit 1.2.6`、`media_kit_video 2.0.1`、`media_kit_libs_android_video 1.3.8`；三份 pub 源码归档已与 lock 的 SHA256 核对。
- Android 视频库 1.3.8 的 `android/build.gradle` 指向 libmpv 构建器 **v1.1.7**。红果使用 v1.1.11 default；这两个构建器的 `depinfo.sh` 均固定 MPV 提交 **78d43740f52db817d98bcf24fb30a76ab6fa13ff**。这说明核心提交相同，不说明最终原生库或所有依赖逐字节相同。
- [v1.1.7 依赖版本](https://github.com/media-kit/libmpv-android-video-build/blob/v1.1.7/buildscripts/include/depinfo.sh)、[MPV 解码选择源码](https://github.com/mpv-player/mpv/blob/78d43740f52db817d98bcf24fb30a76ab6fa13ff/video/decode/vd_lavc.c)、[GPU 默认配置](https://github.com/mpv-player/mpv/blob/78d43740f52db817d98bcf24fb30a76ab6fa13ff/video/out/gpu/video.c)。

旧的 MiniReel 0.2.8 APK 分析与本次公开源码分析分开记录；没有证明旧 APK 的所有参数与本次源码相同，也没有读取 MiniReel 在用户盒子上的实际解码器。

## 解码：最关键差异

| 项目 | MiniReel 锁定依赖的默认行为 | 红果 v0.2.48 / v0.2.49 |
| --- | --- | --- |
| Android 实机解码 | `hwdec=auto-safe`；模拟器关闭硬解 | `hwdec=no`，始终软件解码 |
| 视频输出 | `vo=gpu`、`gpu-context=android`、`opengl-es=yes` | 相同三项配置 |
| HEVC 是否允许尝试硬解 | `hwdec-codecs` 明确包含 `hevc` | 全部硬解已禁用 |
| 硬解失败 | MPV 可尝试其他候选，最终回到软件解码 | 已经使用软件解码 |

`media_kit_video 2.0.1` 的 `android_video_controller/real.dart` 第 137–153 行选择 `auto-safe`；`VideoControllerConfiguration.enableHardwareAcceleration` 默认 true。

这个固定 MPV 版本的候选表将 `mediacodec-copy` 标为自动安全候选，`mediacodec` 直接输出路径没有该标记。因此 Android 的 `auto-safe` 可以尝试 **MediaCodec 解码 → 帧回读 → MPV GPU 渲染**，然后在不可用或失败时使用软件解码。最终是否实际选中，必须读取运行时 `hwdec-current`；不能把配置值当成实际解码器。

这条路径仍使用厂商的 MediaCodec 解码能力，但画面输出路径与 Media3 不同。不能推断“Media3 黑屏 ⇒ MPV 硬解一定黑屏”，也不能保证 MPV 自动模式能修复所有厂商解码问题。初始化/解码错误可触发回退；解码器报告成功而输出黑帧时，自动回退不一定触发。

红果强制软件解码原本是为了绕开厂商解码器故障。HEVC 解码由 CPU 承担，存在流畅度代价。用户反馈与这一风险一致，但目前没有掉帧/负载测量，不能宣布卡顿原因已经证实。

## GPU 渲染：另一组可借鉴的配置

`media_kit 1.2.6` 的 `native/player/real.dart` 明确降低渲染开销。红果没有覆盖这些选项，使用固定 MPV 核心的默认值。

| 配置 | MiniReel 的依赖 | MPV GPU 默认值 |
| --- | --- | --- |
| 放大 `scale` | `bilinear` | `lanczos` |
| 缩小 `dscale` | `bilinear` | `hermite` |
| `dither` | `no` | `fruit`，是否实际抖动也受目标位深等条件影响 |
| `correct-downscaling` | `no` | `yes` |
| `linear-downscaling` | `no` | `yes` |
| `sigmoid-upscaling` | `no` | `yes` |
| `hdr-compute-peak` | `no` | 未在此次对照中作为实际负载结论 |

这是一组偏向移动设备性能的配置：缩放品质有所取舍，GPU 工作更轻。不是全部选项每一帧都生效，也不证明 GPU 就是当前瓶颈。关闭 HDR 峰值计算涉及 HDR 色调映射，不应把它当成没有画质影响的通用优化。

## Surface、音频、缓存和切集

- MiniReel 的 Android 视频依赖在重绑 Surface 时先设 `vo=null`，按顺序传入 `android-surface-size`、`wid`，再恢复 `vo=gpu`；必要时重定位到当前位置。视频输出缓冲区尺寸取旋转后的 `dw/dh`，由 Flutter 视频控件适配显示。红果使用实际 SurfaceHolder 尺寸和 SurfaceView；需要维护各自的显示尺寸约定，不能只抄一个尺寸值。
- MiniReel 依赖在实机默认使用 OpenSL ES。红果 v0.2.48 已改为 `opensles,audiotrack`，并禁用 AudioTrack 浮点 PCM；用户确认有声音。本次不修改这条已经工作的音频路径。
- MiniReel 前台缓存 32 MiB、后退 8 MiB；预加载播放器 8 MiB、后退 0。实际打开视频时明确关闭磁盘缓存，前台目标 20 秒、预加载 12 秒。红果 MPV 缓存预算为 32/8 MiB，不能仅靠增大它来解决持续画面卡顿。
- MiniReel 用两个播放器预加载后续源，再提升备用播放器为前台。这主要减少切集等待，需要额外播放器/资源生命周期管理；本次反馈针对持续播放卡顿，没有接入双播放器预加载。
- MiniReel 打开源时先暂停，确认当前请求有效后再播放；它对原生错误保留 6 秒恢复窗口。错误日志可能先于 MPV 软件回退成功，不能把首个硬解警告立即当成整次播放失败。

## 当时建议的最小调整范围

1. 仅在 MPV 版提供“自动解码 / 软件解码”；自动采用 `auto-safe`，软件保留当前 `no` 作为厂商硬解异常时的退出路径。标准版保持原有 WebView → Media3。
2. 采用 MiniReel 的轻量缩放配置；HDR 相关选项单独评估，不把所有参数直接复制。
3. 播放诊断读取 `hwdec-current`、实际视频解码器、`decoder-frame-drop-count`、`frame-drop-count` 与音画差值。区分配置、实际路径、不可用信息，不能沿用写死的 `mode=software`。
4. 实机比较同一集、相同清晰度的自动和软件模式，检查持续播放流畅度、黑帧、声音、切集及全屏/后台返回。MPV 的回读硬解也有额外复制成本，最终以设备结果为准。

归档源码 SHA256：

- `media_kit_video-2.0.1.tar.gz`: `afaa509e7b7e0bf247557a3a740cde903a52c34ace9810f94500e127bd7b043d`
- `media_kit-1.2.6.tar.gz`: `ae9e79597500c7ad6083a3c7b7b7544ddabfceacce7ae5c9709b0ec16a5d6643`
- `media_kit_libs_android_video-1.3.8.tar.gz`: `3f6274e5ab2de512c286a25c327288601ee445ed8ac319e0ef0b66148bd8f76c`

本地依赖与固定 MPV 源码证据：`/tmp/hongguo-mpv-output-review/`。设备播放结果与源码配置结论分别记录，不能互相替代。

## 红果 v0.2.50 实施

已接入 MPV 专属的持久化自动/软件解码选择，默认 auto-safe；每个播放会话快照其选择。采用轻量缩放选项，保持音频/Surface/输出就绪和 HDR 策略。诊断读取实际 hwdec-current、video-codec、解码/渲染掉帧和有符号 avsync。标准版播放代码未修改，未引入备用播放器。构建/静态验证不能证明实机流畅度已经改善，仍待同一设备比较。

## 后续小步优化（2026-10-12）

用户拖动进度条的 seek 改用 `absolute`，优先落到附近关键帧，降低网络源的交互延迟；启动续播和选集恢复仍在文件加载后使用 `absolute+exact`，保留时间戳精度。MPV 诊断同时读取 `demuxer-cache-duration`，仅用于建立不同清晰度和网络条件下的缓冲基线，暂不改变 32/8 MiB 缓存预算。
