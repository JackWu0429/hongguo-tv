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
| 分类、榜单、推荐 | Go 已接入分类 JSON API；找剧动态筛选和游标分页已验证；四个 `/rank/hot-*` 官网真实榜单已提取 | 其它榜单类型、榜单分页仍需扩展验收 |
| 新剧 | 已实测分类 API 的 online_time 排序，男频/女频使用 gender 参数 | 按日期的上新日历、预约状态尚未接入 |
| 搜索 | `Search` 方法、搜索路径 | 远程搜索与本地剧库搜索的组合方式 |
| 详情和集列表 | Go 已解析网页 `_ROUTER_DATA`，已验证完整 `vid_list` 与锁定状态 | 同系列季关系仍需扩展 |
| 下一季 | `NextSeason`、SeasonRef 模型 | 实际请求、关联关系及末季行为 |
| 播放 | APK 内置签名 `video_model`、`spade_a` 解码、CENC AES-CTR 清晰化、MP4 Range 路由已接入并实测 | 清晰度策略和地址过期重试仍需 Android TV 长时间验收；不依赖 8787/57828 回退 |
| 弹幕 | `Danmaku` 及时间段参数 | 实际上游地址、鉴权、颜色、时间基准 |
| 评论、点赞 | 方法与部分 comment 路径 | 读写参数、登录限制、分页 |
| 历史、收藏、进度 | 已实现设备上的持久记录和断点恢复；playing 后写历史，按集保存时间 | 账号数据合并/同步与原版云端删除语义 |
| 登录、预约、下载 | 前端入口和内部方法 | 完整协议、状态恢复、错误行为 |

## 请求分析方法

按操作采集：打开详情、打开选集、当前季结束、打开评论、开关弹幕、收藏、登录及退出。对比动作前后的请求，区分缓存命中和真实网络请求。

常规代理只能记录程序实际经过代理的请求；是否使用代理、是否接受其证书需先验证。代理不可见时再评估运行时插桩。不能保证某个工具一定能直接挂钩 Go 方法。

只提交脱敏请求及响应样本。账号凭证、设备身份、原始抓包和媒体文件留在仓库外。

## 排行榜与新剧页面（2026-10-06）

本地 `GET /api/v1/rank?path=/rank/hot-drama` 支持 `hot-drama`、`hot-real-drama`、`hot-comic-drama` 和 `hot-ai-drama`。官网普通 UA 的榜单内容可能为空，本次以 Googlebot UA 实测返回 `_ROUTER_DATA` 中 `content.rankList`。这是一条当前可用的网页数据路径，不等于已复刻 Mac 客户端全部榜单接口。

本地 `GET /api/v1/category?path=/new/recommend` 复用分类 JSON API，只将排序设置为 `online_time`。返回最新列表不表示其中所有剧都在今天上架，因此上新日历只提供日期条和待接入状态，不把新剧列表分配到任意日期。

分类 API 的 HEIC 封面无法由 Chromium / Android WebView 直接显示。本次实测四张封面在官网图片 CDN 的 `/novel-pic/<object>~tplv-shrink:640:0.image` 上返回 JPEG；模型同时保留 `cover` 和 HEIC 专用 `cover_fallback`，普通签名图片地址不变。

本轮验证覆盖 Go 测试与 vet、JS 语法、真实四个热播榜和最新剧 API、1920×1080 / 1280×720 浏览器焦点路径、详情关闭与播放返回、海报加载。Android TV 实体遥控器和长时间播放验收仍未进行。

## 找剧筛选（2026-10-06 实测）

继续使用客户端分类 JSON 接口 `POST /reading/distribution/category/landpage/v/`。请求 `need_selector_panel=true`、`req_type="default"` 时，响应 `data.selector_rows` 提供各组的 `type`、`row_name` 和 `items[].selector_item_id/show_name`，同时返回第一页内容。`only_content` 不返回面板，`req_type="all"` 实测返回空内容，不能用它请求完整面板。

| 维度 | select_items 字段 | 已验证的示例值 |
| --- | --- | --- |
| 体裁 | genre | short_play / comic_series / ai_series |
| 主题 | category_dim_theme | cate_165（悬疑） |
| 设定 | category_dim_role | cate_36（重生） |
| 背景 | category_dim_epoch | cate_758（古代） |
| 推荐 | sort | hot_score / online_time / hot_collect |
| 受众 | gender | 1（男频）/ 0（女频） |
| 时间 | online_time | days_7 / days_14 / days_30 / days_90 |
| 状态（漫剧）| creation_status | creation_status_0（已完结）/ creation_status_1（连载中） |

选项由上游面板生成，不维护网页 slug 到客户端标签 ID 的猜测映射。真人剧/全部面板实测 7 组，主题 29 项、设定 42 项；漫剧面板实测 8 组，主题/设定各 8 项，并增加状态。AI剧实测 7 组。Mac 截图中的长度条件尚未取得已验证的参数，不提供虚假按钮。

选择“全部”传递空数组；特别是 `genre=[]` 才表示全部体裁。省略字段与显式空值有区别：现有频道仍保留默认体裁和热度排序，找剧页面则明确传入所选条件。选择体裁时同步切换 `req_scene`；主题、设定、背景、状态清空后重新请求面板，避免沿用其它体裁的标签。

本地 `/api/v1/category` 增加与表中同名的单值查询参数，以及 `selectors=1`。返回 `filters:[{type,label,options:[{id,label}]}]`。不合格式的筛选值返回 400。分页继续传上次的 `next_offset`、`session_id` 与已显示的字符串 ID 列表 `shown`；客户端追加、去重并在游标不前进时停止继续请求。

实测悬疑、重生、古代、男频、女频、7 天内上新、最高收藏、漫剧、AI剧均返回不同的有效内容；悬疑第二页返回 15 个新条目。UI 验证追加后原卡片 DOM 保留。关键词搜索仍使用已确认的官网搜索实现，单独展示结果，筛选条件不假装作用于关键词搜索。

## 本机记录（2026-10-06）

本地 `GET /api/v1/library` 读取记录；`POST` 的 `action` 支持 `progress`、`favorite`、`like`、`remove`、`clear`。移除和清空以 `kind=history/favorites/likes` 分别处理。历史最多 200 部，收藏与点赞各最多 300 部；仅保存精简卡片与当前集的 ID、时间，不复制完整集列表。当前集 ID 单独存为 `video_id`，重新播放仍按详情解析第一集，避免将上一集误当作第一集。

Android 使用应用私有 files 目录下的 `hongguo-tv/library.json`，与可清理的视频 cache 目录分开；Go 通过临时文件落盘后替换，失败时不公布新状态。桌面验证可通过 `-data-dir` 指定隔离目录。本机收藏/点赞尚不代表红果账号的云端状态。

本轮浏览器使用真实分类、详情和集 ID，媒体响应替换为支持 Range 的测试 MP4，验证实际开始播放才记历史、暂停保存、服务重启恢复、断点 seek、自然结束后的下一集及整季结束重播第一集。也验证两种分辨率的网格导航、清空确认默认取消、逐卡移除后的焦点以及播放返回原卡片。此轮没有新增 Android TV 真机遥控器或真实 CENC 长时间播放验收。
