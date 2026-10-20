# 红果短剧 webOS 实验版

这个目录是 LG webOS TV 的实验性 Web App 外壳。它复用 Android、桌面和浏览器预览使用的 Web UI，并通过 webOS JavaScript Service 提供本机 HTTP 边界。

当前源码已接入并验证的链路：

- `file://` 页面加载和相对资源路径；
- TV Web App 的应用元数据、图标和 Luna Service 注册；
- 本机 `127.0.0.1` 健康检查、状态诊断和结构化错误；
- 红果 `video_model` 请求、一次性设备身份和 Passport 签名（`X-Gorgon`、`X-Helios`、`X-Medusa`）；
- `main_url` 地址解析、`spade_a` CENC 密钥解码、MP4 AES-CTR 样本解密和 `hvc1/mp4a` 恢复；
- 本地媒体缓存和 `Range` 代理，页面继续使用同一套 HTML5 播放接口；
- 分类（含筛选器和连续分页）、推荐、排行榜、日历、搜索和剧集详情的真实数据接口；
- 搜索建议、演员作品、分季、榜单雷达、评论/弹幕/回复读取和本地播放记录；
- `ares-package` 生成 `.ipk` 的构建链。
- 随包提供 LG 官方 `webOSTV.js`，并使用兼容 webOS 5.x 的 Luna 调用格式。
- 与 Android TV / 桌面版同步的榜单雷达页面（官方榜分类与飙升榜数据）。

协议、解密和媒体文件已在 macOS 网络环境中用真实上游数据验证，能够得到可被 `ffprobe` 识别的 HEVC/AAC MP4。LG webOS 真机尚未验证，因此不能把 `playback_verified` 视为通过；具体电视的 HEVC、AAC、Range 行为仍需真机确认。当前实现是完整下载后再解密，启动和磁盘占用会高于 Android Go 的分段方案。

webOS Service 已接入账号登录、国际手机号发码/MFA、预约、追更、通知、评论/弹幕/回复发布、点赞以及云端收藏/历史同步。账号态写入仍需要真实红果账号验收；未登录时会按接口契约返回 `ACCOUNT_REQUIRED`，不会伪造成功结果。当前版本仍是实验版，真实 LG 电视播放和账号写入结果不能仅凭 macOS 或 Simulator 推断。

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

发布前最低验收要求：

1. 在 macOS 上运行 `bash scripts/verify_webos.sh`，并使用真实上游完成公共接口验收；
2. 在 webOS Simulator 中验证服务唤醒、首页列表、搜索、详情和连续播放；
3. 在至少一台 LG 真机验证 HTTP Service、HEVC/AAC 解码、Range 播放和遥控器焦点；
4. 当前公开 IPK 仅供社区真机验证，不是稳定版。只有账号态接口和 LG 真机结果都明确后，才能将 webOS 标为正式支持。
