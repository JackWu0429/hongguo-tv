# 应用内更新

源码保持在私有仓库 `aston314/hongguo-tv`。公开仓库 `aston314/hongguo-tv-releases` 只保存 README、最新 update.json 和正式 Release 文件。任何人可以下载正式 APK。

Android 6/API 23 起支持。首次安装带更新功能的版本（0.2.7 或更高）需要手动覆盖升级，此后可从“我的 → 版本更新”检查并下载安装新版本。系统安装界面仍需要用户确认。正式版包名和签名保持不变，升级保留账号与记录；调试版不覆盖安装正式版。

## 检查与操作

- 每次启动，若距离上次自动检查不足 24 小时则复用缓存。失败也计入自动检查次数，手动检查始终可用。播放页和其他弹窗期间不弹更新提示；待回到普通页面再提示。对同一版本选择“稍后”后不再自动重复提示，手动检查仍可查看。
- 原生壳负责网络和安装；UI 只调用受本机页面限制的桥接接口。默认下载代理 https://ghfast.top/；失败后尝试 GitHub 直连。“下载代理”可改为另一 HTTPS 前缀，留空则直连。检查入口固定为公开仓库 main/update.json，带检查时间参数并请求禁缓存；APK 固定版本路径，不能用可变的 latest APK 路径。
- JSON 包含 schema、package_name、version_code、version_name、min_sdk、size、sha256、download_url、release_notes、published_at。按整数 versionCode 判断升级；下载地址仅允许公开发行仓库的对应版本 APK。
- 下载必须在用户确认后进行。最多 100 MiB，通过 size、SHA256、实际 APK 包名/版本及当前安装应用的完整签名集合核验；降级、外来包、截断或代理 HTML 被拒绝。Android 8 及以上另需允许该应用安装更新，Android 6 使用系统的安装来源设置。
- app-updates 缓存最多保存一个完整 APK 和一个当前半成品，下载前替换旧包，失败/取消清理半成品。升级后启动删除已安装版本的完整包，未安装文件最迟在超过 24 小时后的下一次启动清理。与视频缓存、账号文件分离；缓存不足失败可重试，不清账号数据。
- 断网、错误 HTML、大小不符、校验值不符和签名不符均不会交给系统安装；代理失败后用直连重新完整下载，不复用坏的前缀文件。取消安装或拒绝安装权限时保留验证过的包供重试，绝不把下载成功当作升级成功。更新器不卸载应用、不写账号或剧库，不自动静默降级；安装后的新版本若启动失败，保留原生启动错误与重试入口。
- 更新源返回比当前已安装版本更旧的 versionCode，或相同 code 却不同版本名时，按陈旧/不一致元数据处理并尝试备用源；两个来源都无有效信息时显示检查失败，不误报“已是最新版本”。

## 发布

私有仓库 Actions Secret `HONGGUO_RELEASES_TOKEN` 需为专用 Fine-grained PAT：仅公开发行仓库、Contents Read and write。配置并确认凭证后，将 Actions Variable `HONGGUO_PUBLIC_RELEASES_ENABLED` 设为 `true` 启用自动发布。默认关闭，未配置时正式编译和私有 Release 正常完成；可用本机已登录的 gh 调用公开上传脚本完成本次发行。不能使用私有仓库自带 GITHUB_TOKEN 写另一个仓库，也不将本机 gh 的广泛权限登录凭证复制到 Actions 或 APK。Token 过期后需在 Secrets 更新。

Release workflow 从 build.gradle 读取版本，生成 APK/SHA256SUMS/update.json，先在公开仓库创建草稿、上传并验证文件，再发布 Release，最后更新稳定 JSON。公开发布任务串行，同版本不替换不同 APK，旧版本不能覆盖较新的 update.json。上传脚本只允许明确的三项发行文件，不上传工程源码或打包整个目录。

创建草稿后沿用接口返回的 Release ID，不依赖尚未生效的标签查询。中断后重试保留已有且校验一致的附件，只补齐缺失文件；所有附件校验完成并正式发布后才更新稳定 JSON。已发布附件不覆盖，重复执行且内容一致时不产生多余提交。

凭证迟到、短暂断网或公开上传失败时，可以手动运行 `Publish signed download` 并指定已完成的版本标签。它下载原有正式 Release 的签名文件并核验 SHA256 后，只重试公开发布，不重新编译或更换同版本的安装包。

测试区分 Go/JS/JVM/Android Lint/签名和包内容验证，与真实 Android 6 安装来源、遥控器、代理网络及跨版本覆盖安装验收；浏览器模拟不能替代后者。
