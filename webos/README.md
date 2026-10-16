# 红果短剧 webOS 实验版

这个目录是 LG webOS TV 的实验性 Web App 外壳。它复用 Android、桌面和浏览器预览使用的 Web UI，并通过 webOS JavaScript Service 提供本机 HTTP 边界。

当前包可以验证：

- `file://` 页面加载和相对资源路径；
- TV Web App 的应用元数据、图标和 Luna Service 注册；
- 本机 `127.0.0.1` 健康检查、状态诊断和结构化未实现错误；
- `ares-package` 生成 `.ipk` 的构建链。

当前包不会伪装成完整的红果客户端：红果签名请求、CENC 解密、设备身份轮换和真实媒体 Range 代理还没有从 Go 核心移植到 JS Service。因此服务对业务/媒体路由返回明确的 `501 WEBOS_PROVIDER_NOT_IMPLEMENTED`，真实 LG 设备上的 HEVC、bytevc1 和音画表现也没有验证。

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

## 后续接入边界

优先把现有 Go provider 的请求签名、一次性设备身份、地址刷新和 Range 缓存逐步移植到 Service。媒体必须继续由本机代理提供，页面只消费 HTTP 地址；不要把签名密钥放进页面 JavaScript，也不要复制带 GPL 许可限制的第三方 provider 实现。
