# 协议证据与待验证接口

日期：2026-10-06。参考 [hongguo-player 发布仓库](https://github.com/yangbin1322/hongguo-player)。该仓库没有公开客户端业务源码。

## 证据分类

1. 发布版嵌入前端：能够确认前端调用的方法、参数和模型。
2. 二进制符号及字符串：能够确认部分 Go 方法、JSON 标签和 HTTP 路径。
3. 运行时请求与响应：才能确认某个方法实际使用的接口、参数、签名和组合算法。

前两种证据不能代替第三种。数据模型存在不代表已确认红果服务端会提供所有对应字段。

## 内部方法

前端通过 Wails 调用 `window.go.app.App.*`，例如：

```javascript
window.go.app.App.SeriesDetail(seriesId)
window.go.app.App.NextSeason(seriesId, seasonIndex)
window.go.app.App.PlayInfo(seriesId, videoId)
window.go.app.App.Danmaku(seriesId, videoId, startMs, endMs)
```

这些是程序内部方法，不是红果公开 HTTP 路由。TV APK 提供对应的本地 HTTP 桥接，Go 核心负责具体网络和本地逻辑。

## 季与集模型

嵌入前端可观察到以下字段：

```text
Episode: index, videoId, title, duration, cover, locked,
         commentCount, likeCount, liked

Series: id, title, cover, intro, tags, episodeCount, episodes,
        watchedEpisode, serializing, startVideoId, startEpisode,
        seasonIndex, multiSeason

SeasonRef: seriesId, firstVideoId, seasonIndex, title, cover
```

前端在本季结束时调用 `NextSeason(series.id, series.seasonIndex || 0)`，若返回有效 `seriesId` 和 `firstVideoId`，再切换播放对象。

二进制包含：

```text
hg-go/internal/app.(*App).NextSeason
hg-go/pkg/service.(*Library).NextSeason
hg-go/pkg/hgapi.(*Client).NextSeason
hg-go/pkg/hgapi/season.go
json:"season_index"
json:"is_multi_season"
```

尚未确认 `NextSeason` 底层使用哪个 HTTP 路径，也未确认是服务端季关系、多个请求组合还是本地算法。因此不能宣称它已经证明比标题识别更可靠，也不能宣称它完全不使用标题。

现有 Lampa 插件已经实现标题规则、搜索建议和详情验证驱动的同系列与下一季。该行为可作为参考，但本项目复刻原版内部季关系前仍需运行时证据。

## 候选上游路径

发布版保留了以下相关路径字符串：

```text
/reading/distribution/category/landpage/v1/
/reading/bookapi/search/tab/v/
/novel/player/video_detail/v1/
/novel/player/multi_video_detail/preload/v1
/novel/player/video_model/v1/
/novel/player/multi_video_model/player/v1
```

这些是分析线索，不是已经测试通过的 Android 接口清单。当前网页分类可用的 `/reading/distribution/category/landpage/v/` 与桌面二进制出现的 `/v1/` 也应分别验证。

## 功能验证表

| 功能 | 已知线索 | 仍需确认 |
| --- | --- | --- |
| 分类、榜单、推荐 | Go 已接入 `/reading/distribution/category/landpage/v/`，已验证真实热播分类响应 | 分页、频道、筛选参数仍需扩展验收 |
| 搜索 | `Search` 方法、搜索路径 | 远程搜索与本地剧库搜索的组合方式 |
| 详情和集列表 | Go 已解析网页 `_ROUTER_DATA`，已验证完整 `vid_list` 与锁定状态 | 同系列季关系仍需扩展 |
| 下一季 | `NextSeason`、SeasonRef 模型 | 实际请求、关联关系及末季行为 |
| 播放 | APK 内置签名 `video_model`、`spade_a` 解码、CENC AES-CTR 清晰化、MP4 Range 路由已接入并实测 | 清晰度策略和地址过期重试仍需 Android TV 长时间验收；不依赖 8787/57828 回退 |
| 弹幕 | `Danmaku` 及时间段参数 | 实际上游地址、鉴权、颜色、时间基准 |
| 评论、点赞 | 方法与部分 comment 路径 | 读写参数、登录限制、分页 |
| 历史、收藏、进度 | 本地存储与网络相关方法 | 本地与账号数据合并、同步和删除语义 |
| 登录、预约、下载 | 前端入口和内部方法 | 完整协议、状态恢复、错误行为 |

## 请求分析方法

按操作采集：打开详情、打开选集、当前季结束、打开评论、开关弹幕、收藏、登录及退出。对比动作前后的请求，区分缓存命中和真实网络请求。

常规代理只能记录程序实际经过代理的请求；是否使用代理、是否接受其证书需先验证。代理不可见时再评估运行时插桩。不能保证某个工具一定能直接挂钩 Go 方法。

只提交脱敏请求及响应样本。账号凭证、设备身份、原始抓包和媒体文件留在仓库外。
