# 红果短剧 webOS 实验版

这个目录是 LG webOS TV 的实验性 Web App 外壳。它复用 Android、桌面和浏览器预览使用的 Web UI，并通过 webOS JavaScript Service 提供本机 HTTP 边界。

当前包已接入真实业务链路，可以验证：

- `file://` 页面加载和相对资源路径；
- TV Web App 的应用元数据、图标和 Luna Service 注册；
- 本机 `127.0.0.1` 健康检查、状态诊断和结构化错误；
- 红果 `video_model` 请求、一次性设备身份和 Passport 签名（`X-Gorgon`、`X-Helios`、`X-Medusa`）；
- `main_url` 地址解析、`spade_a` CENC 密钥解码、MP4 AES-CTR 样本解密和 `hvc1/mp4a` 恢复；
- 本地媒体缓存和 `Range` 代理，页面继续使用同一套 HTML5 播放接口；
- 分类、推荐、排行榜、搜索和剧集详情的真实数据接口；
- `ares-package` 生成 `.ipk` 的构建链。

协议、解密和媒体文件已在 macOS 网络环境中用真实上游数据验证，能够得到可被 `ffprobe` 识别的 HEVC/AAC MP4。LG webOS 真机尚未接入验证，因此不能把 `playback_verified` 视为已通过；具体电视的 HEVC、AAC、Range 行为仍需真机确认。当前实现是完整下载后再解密，启动和磁盘占用会高于 Android Go 的分段方案；账号、预约、追更、评论和弹幕等需要登录态的接口仍保留为后续接入项。

## 构建

在仓库根目录执行：

```sh
bash scripts/verify_webos.sh
bash scripts/build_webos.sh --check-only
```

安装了 LG webOS CLI 后，去掉 `--check-only` 即可生成 `dist/*.ipk`：

```sh
bash scripts/build_webos.sh
```

也可以显式指定 CLI 目录：

```sh
ARES_DIR="$HOME/.local/webos" bash scripts/build_webos.sh
```

应用 ID 是 `com.aston314.hongguo.webos`，Service ID 是 `com.aston314.hongguo.webos.service`。安装和签名需要开发者模式、设备密钥和 LG 的 `ares-install`/`ares-launch` 工具；本仓库不保存这些密钥。

## 当前边界

签名、解密和媒体代理都在 Service 内执行，页面只消费本机 HTTP 地址；不要把签名逻辑放进页面 JavaScript，也不要复制带 GPL 许可限制的第三方 provider 实现。
