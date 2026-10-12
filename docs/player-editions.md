# 双版本播放与更新

一套业务代码，通过 Gradle 的 `standard` / `mpv` flavor 生成两种 APK，最低均为 Android 6，包含 arm64-v8a、armeabi-v7a、x86_64。

| | 标准版 | MPV 版 |
|---|---|---|
| 名称 | 红果短剧 | 红果短剧 MPV |
| 包名 | rocks.aston.hongguotv | rocks.aston.hongguotv.mpv |
| 播放 | WebView → Media3 兼容回退 | libmpv，hwdec=no 软件解码 |
| 更新 | update.json | update-mpv.json |
| 安装包 | hongguo-tv-VERSION.apk | hongguo-tv-mpv-VERSION.apk |

标准版不包含 libmpv 或 JNI 桥。MPV 版固定使用 MPV，不自动回退到标准版播放路径。
两版可以同时安装，本地账号、历史、设置独立；不是原地切换播放器。
标准版沿用原包名和签名，可覆盖升级旧正式版。云端数据依原有登录同步规则处理。

每个渠道分别递增 versionCode。更新校验版本类型、包名、APK 文件名、版本、大小、SHA256 与签名。
更新失败保留原应用；渠道不存在时不尝试安装另一版。公开同步拒绝同 versionCode 更换 APK 字节，
旧版补同步不会降低任一渠道的最新版本。

MPV 使用 media-kit default LGPL 库，不使用 full/GPL 包。正式发布时自动提供对应库源码、依赖、
上游补丁、构建/替换工具与许可声明；附件仅包含明确允许的文件，不打包私有业务源码。
“我的 → 开源许可”可离线查看许可。附件用于满足许可及研究，不承诺源码答疑。

## 构建与验证

Android Go、JNI、APK 只在 GitHub Actions 构建。本机可运行 Go/JS/Python 测试、预览 UI、
下载及校验依赖，但不进行 Android 编译。

- CI：显式运行两版 debug 单元测试、构建和 lint，校验三 ABI、包名、签名及库隔离。
- Release workflow_dispatch：构建两版正式签名包，核验签名和发布文件，不创建 Release/tag、不更新下载渠道。
- 版本 tag：发布两版 APK、两个更新清单、库源码 ZIP 与校验和，再把相同文件同步到公开下载仓库。
- 不上传临时 Actions APK artifact，避免配额再次耗尽。

MPV 渲染重启事件与有效视频尺寸、有效 Surface 共同释放加载层。
该信号仍不能证明实体屏幕真的有画面，诊断注明 `playback-restart`；
软件 HEVC 的流畅度、音画同步、连续切集和前后台需要设备验收。
