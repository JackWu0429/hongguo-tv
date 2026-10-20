# webOS 验证流程

本文记录红果短剧 webOS 实验版的分层验证方法。当前源码、签名与解密流程、服务接口测试不等于 Simulator 或 LG 电视验收通过；每次记录结果时都要注明实际运行的平台和通过的层级。

## 验证层级

1. **源码与打包检查**：检查应用/Service 清单、共享 UI 资源、JS 语法、单元测试和 IPK 文件结构。不能证明上游服务可达、Luna Service 能启动或视频能播放。
2. **macOS 上游/文件验证**：验证真实目录、详情、搜索和播放解析响应，以及下载、CENC 解密后的媒体文件结构。不能证明 webOS WebView、Luna 或电视硬件解码正常。
3. **webOS Simulator**：分别验证 HTTP 直连和 Luna Service 两层。本机 HTTP 健康检查、真实目录数据、页面焦点、HTML5 视频解码、seek 和切集都要记录实际路径。Simulator 的结果不能替代 LG 真机验收。
4. **LG 真机**：至少验证服务启动、真实数据、遥控器焦点、画面与声音、seek、连续切集和长时间播放。账号登录及云端写入需要真实账号单独验收。

## 源码与打包检查

在仓库根目录运行：

```sh
bash scripts/verify_webos.sh
bash scripts/build_webos.sh --check-only
```

`verify_webos.sh` 会检查 `appinfo.json`、Service 清单、共享 UI 连接诊断元素、真实 provider/签名器的关键入口、webOS adapter，并运行 adapter 与 Service 生命周期测试；随后以 `--check-only` 方式检查应用和 Service staging。它不会联系真实电视，也不会发布 IPK。

正式源码默认只使用 `luna://com.aston314.hongguo.webos.service` 和 `http://127.0.0.1:7655`。Simulator 临时包必须使用 `WEBOS_STAGE_OUTPUT`、`WEBOS_STAGE_APP_ID_SUFFIX` 生成独立 app/Service ID；开发机地址只能通过 `WEBOS_STAGE_SERVICE_BASE` 注入 staging。`--stage-package` 生成的包必须用 `python3 scripts/verify_webos_ipk.py --staging <ipk>` 校验，不能覆盖正式 app。

Service 的 Node 测试可单独运行：

```sh
node webos/service/passport-sign.test.js
node webos/service/provider.test.js
node webos/service/account.test.js
node webos/service/service.test.js
node webos/service/number-input.test.js
```

生成 IPK 后，检查包内应用和 Service 入口：

```sh
python3 scripts/verify_webos_ipk.py dist/webos/<生成的安装包>.ipk
```

这只是包结构检查，不是 Simulator 或电视播放证明。

## Simulator 准备

先确保 webOS Simulator 已安装并能正常启动。每次运行使用新的 staging 目录；构建脚本要求该目录位于当前用户主目录内，而且目标目录必须尚不存在：

```sh
stage="$HOME/webos-simulator/hongguo-run"
WEBOS_STAGE_OUTPUT="$stage" \
WEBOS_SIMULATOR_PROBE="$PWD/scripts/webos_simulator_probe.js" \
bash scripts/build_webos.sh --check-only
```

该命令会把应用和 JS Service 分别放到 `$stage/app` 与 `$stage/service`，并在 app 中加入仅供诊断的播放探针。探针会打开固定的真实剧集并尝试切换前两集；不要用它作为普通用户验收包，也不要把它包含在正式 IPK 中。若目录已存在，为避免覆盖已有证据，换一个新的目录名。

另开终端启动本机报告接收器，报告只保存在本机：

```sh
node scripts/webos_simulator_report_server.js "$HOME/webos-simulator/hongguo-run/report.json" 17656
```

接收器仅绑定 `127.0.0.1`。主 Service 的 HTTP API 使用 `127.0.0.1:7655`；`17656` 只用于探针报告，不能与应用 Service 端口混淆。

在 Simulator 中按以下顺序操作：

1. 将 `$stage/service` 注册为可供 Simulator 加载的 JS Service，将 `$stage/app` 作为文件系统应用运行；确认应用包名、Service ID 和入口文件与仓库清单一致。具体菜单名称随 Simulator 版本变化，应以当前安装版本显示为准。
2. 从 App List 启动应用。首次启动后等待连接状态完成；若出现连接诊断弹窗，先保存其内容，不要继续把页面空态当作接口空数据。
3. HTTP 直连测试使用独立 staging 包和开发机局域网地址，例如：

   ```sh
   WEBOS_STAGE_OUTPUT="$HOME/webos-simulator/hongguo-run6-http" \
   WEBOS_STAGE_APP_ID_SUFFIX=.run6-http \
   WEBOS_STAGE_CONNECTION_MODE=http-direct \
   WEBOS_STAGE_SERVICE_BASE=http://192.168.2.124:17657 \
   WEBOS_SIMULATOR_PROBE="$PWD/scripts/webos_simulator_probe.js" \
   bash scripts/build_webos.sh --check-only
   ```

   开发机可在另一个终端通过 HTTP-only 启动器提供服务；它不需要安装 webOS 的 `webos-service` Node 模块，并使用独立临时数据目录：

   ```sh
   HONGGUO_WEBOS_BIND_HOST=192.168.2.124 HONGGUO_WEBOS_PORT=17657 \
   node scripts/run_webos_http_direct_service.js
   ```

   这一层只证明 Simulator 能访问开发机 HTTP 服务；诊断应显示 `mode: http-direct` 和“Luna Service 未验证”。开发机地址只能用于 staging 配置，不能写回正式源码。
4. Luna 测试使用另一个独立 staging 包，保持 `SERVICE_MODE=luna`、`SERVICE_BASE=http://127.0.0.1:7655`，并加载同一 staging 的 Service。只有 Console 中 `window.HongguoWebOS.getDiagnostic()` 返回 `code: READY` 且消息包含 Luna 成功，才能记录 Luna 通过；HTTP health 单独记录 200/`ready: true`。
5. 在每层记录 app ID、Service ID、模式、健康检查结果和实际 API 请求；HTTP 直连通过不能替代 Luna 通过。
6. 检查真实数据页面：推荐/分类、排行榜、搜索及建议、详情和演员/分季。记录请求路径、HTTP 状态、列表条数和页面结果；不要记录手机号、Cookie、签名头、播放 URL 或密钥。
7. 播放验收再单独进行：探针报告需要显示 `play/info` 两集成功、视频宽高有效、解码或呈现帧增长、播放时钟持续前进、seek 完成、方向键切至第二集后时钟继续前进，并且没有 `MediaError`。

探针生成报告后，在仓库根目录运行：

```sh
python3 scripts/verify_webos_simulator_playback.py "$HOME/webos-simulator/hongguo-run/report.json"
```

校验脚本会拒绝包含 URL、路径、Token、密钥、授权头、Cookie 或原始响应体的报告。若报告校验失败，保留错误阶段和脱敏的请求状态即可；不要把原始敏感响应附到 issue。

## 故障诊断

若右上角一直显示连接中或连接失败，按层定位，不要先归因于上游数据：

- **Luna ping 失败或 `LUNA_TIMEOUT`**：检查 Simulator 是否加载了正确的 staging `$stage/service`，manifest 中是否注册对应的独立 Service ID，以及 Service 主进程是否启动。HTTP 直连 staging 的成功不能作为 Luna 证据。
- **Luna 成功但 HTTP health 失败**：检查 Service 是否监听 `127.0.0.1:7655`、端口是否冲突，以及 `getDiagnostics` 返回的 `stage`、`code` 和 `lastStartupError`。
- **health 成功但列表失败**：记录失败的 API 路径、HTTP 状态和页面错误码，再确认 DNS/上游 HTTP 是否可用；不要记录请求签名或认证信息。
- **列表正常但视频失败**：记录 `play/info` 是否成功、媒体代理响应状态、HTMLMediaElement 的 `readyState`/`error`、视频尺寸和帧计数。URL、密钥及媒体响应内容必须脱敏。

每次验收至少记录：源码 commit、app version、Simulator/系统版本、app 与 Service 的 staging 路径、上述健康检查结果、页面数据结果、播放探针校验结果，以及是否为 LG 真机。未执行的步骤标记为“未验证”，不要写成通过。

## 当前记录

- **run8，2026-10-21，源码版本 0.2.99，基于 HEAD `5835552533ab89676c4c2ff8804cddc0dcd7441e` 加当前工作区改动。** 本次构建的是独立测试包，不是正式发布包。
- **API 接入审计：通过。** Service 回归测试遍历 Go 主应用注册的 API 路由，要求没有 404、501 或 `WEBOS_PROVIDER_NOT_IMPLEMENTED`。真实 API smoke 对推荐 16/36/39、三类分类、新剧、榜单、搜索/建议、日历、详情/分季、演员作品、互动、评论/弹幕/回复和雷达共 22 项返回预期 200；频道 45 未登录返回 401 `ACCOUNT_REQUIRED`，与主应用一致。频道 45 已接入账号签名请求、只取 `show_type=648` 追更 cell 和后续分页；fixture 验证覆盖 647 演员 cell 排除。真实登录态频道 45 尚未用账号验收。
- **HTTP 直连包：构建及包结构通过，Simulator 未验证。** IPK：`/Users/aston/webos-simulator-validation-20261021-run8-http/test-ipk/com.aston314.hongguo.webos.run8-http_0.2.99_all.ipk`。此 staging 的 `SERVICE_MODE=http-direct`、开发机地址 `192.168.2.124:17659` 和报告地址 `192.168.2.124:17662` 只写入该测试包。开发机 HTTP Service 的 LAN health 返回 200，真实 HTTP API smoke 已执行。尝试 `ares-install --device emulator` 时连接 `127.0.0.1:6622` 返回 `ECONNREFUSED`，所以还没有 Simulator 安装、页面或网络访问结果。
- **Luna 包：构建及包结构通过，Simulator Luna 未验证。** IPK：`/Users/aston/webos-simulator-validation-20261021-run8-luna/test-ipk/com.aston314.hongguo.webos.run8-luna_0.2.99_all.ipk`。它保留 Luna 模式和本机 `127.0.0.1:7655`；当前 Simulator emulator 未监听，因此没有安装包或发起 Luna IPC。
- **第二集 500：当前未复现。** 对第一、二集交替执行 6 次真实 `video_model` 请求，均为 HTTP 200、约 23.8–24.7 KB，并含 360P 至 1080P 五档。随后通过 LAN HTTP Service 顺序请求第二集、第一集 `play/info`，两次均为 HTTP 200、720P，分别约 733 ms 与 1000 ms。结合旧记录中的 HTTP 200 空响应重试，现有证据更符合上游间歇空响应，未显示第二集特有问题；旧 run5 的 0.2.92 HTTP 500 不能由这轮 Simulator 结果解释，因为本轮尚未能连接 Simulator。
- 正式源码中的 `SERVICE_MODE=luna`、`SERVICE_URI=luna://com.aston314.hongguo.webos.service` 和 `SERVICE_BASE=http://127.0.0.1:7655` 未注入开发机 IP。正式包仍须从干净 staging 构建。
- LG webOS 真机验证尚未完成。
- 本文记录的是可复用流程，不表示上述未通过/未执行项目已解决。
