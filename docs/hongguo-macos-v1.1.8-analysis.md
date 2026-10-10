# 红果短剧 macOS v1.1.8 分析记录

这份记录用于后续对比桌面版功能。样本是下载页提供的 macOS Universal 安装包，不是源码移植依据。

## 样本

- 下载页：<https://hongguo.235698.xyz/download>
- 包：`hongguo-v1.1.8-macos-universal.zip`
- ZIP SHA-256：`b70628b56c4bde9b48197b19489edccf772c1db2fcd78de3c75ef62941477ce3`
- `CFBundleIdentifier`：`com.wails.hgplayer`
- 版本：`1.1.8`
- 最低 macOS：`10.13.0`
- Universal 架构：`x86_64`、`arm64`
- Go：`go1.25.0`；Wails：`github.com/wailsapp/wails/v2 v2.11.0`

压缩包只有 `.app`、Universal Mach-O、图标和 `Info.plist`，没有 Vue/TypeScript、Go 或可编译工程。前端构建资源嵌入二进制，能看到路由、Wails 方法名和 JSON 字段，但不能恢复原始源码。

## 已确认能力

二进制中可确认以下 Wails 方法和页面路由：

```text
/recommend  /search  /rank  /new  /series/:id
/history  /favorites  /likes  /reservations  /follows
/login  /mine  /settings  /play/:seriesId/:videoId?

FollowUpdates  AllFollowUpdates  SetFollowUpdate
Reviews  ReviewReplies  SendReview  SendReviewReply  LikeReview
Related  NextSeason  SeriesSeasons
```

内容与账号字段包括：

```text
follow_update_list  mix_data  cursor  has_more
latest_watched_vid_index  has_watched_latest_episode
series_status  follow_update_time_stamp  show_update_frequency
detail_page_more_related  rawRelatedVideo.model
review_list  reviewBizParam  reviewReplyListAPI
```

已出现的网络路径包括：

```text
/reading/user/subscribe/list/v1
/reading/user/subscribe/delete/v
/reading/bookapi/search/uncover_subscribe/v
/reading/bookapi/plan/v
/novel/player/multi_video_detail/preload/v1
```

`/reading/bookapi/search/uncover_subscribe/v` 是预约，不能拿来实现追更。新版桌面端的追更列表使用独立游标和 `mix_data`/`follow_update_list`，TV 端应保留 `cursor`，不能把它强行转成 `offset`。

`rawFollowUpdate` 的静态结构是：

```text
video_id
common.title / common.cover / common.video_content_type
expand.episode_cnt / expand.latest_watched_vid_index
expand.has_watched_latest_episode / expand.series_status
expand.extra.follow_update_time_stamp
expand.update_info.show_update_frequency
```

TV 端已增加兼容归一化：合并 `common`、`expand`、`extra`、`update_info`，再生成统一短剧卡片。接口返回结构若缺少可用 `series_id`，不能用标题猜 ID，应保留错误或要求详情接口补齐。

## 播放与本地数据边界

二进制包含 `hg-go/pkg/media/cenc`、`Spade`、`MultiVideoModel`、HEIC 转 JPEG 和 SQLite。本地数据库包含收藏、点赞、账号、观看历史/进度等结构。因此桌面端“已加载剧库”不是网页搜索结果，也不能假设只有一个公开搜索接口就能完全复现桌面端。

Android TV 继续使用已验证的 WebView/Media3 播放策略；桌面端的 CENC、Spade、HEIC 能力只作为协议和字段参考，不改变 Android 6/9 已验证播放链路。

## 后续版本对比

1. 下载新包并记录 ZIP SHA-256、`Info.plist` 和 `go version -m`。
2. 分别提取 `arm64`、`x86_64`，比较 `hg-go/pkg/hgapi` 与 `hg-go/pkg/service` 方法名。
3. 比较 `/reading/`、`/novel/`、`/passport/` 路径和 `json:"..."` 字段。
4. 重点复核 `FollowUpdates` 的 `cursor`、追更写入、剧评、相关推荐和 `NextSeason`。
5. 只有静态路径、方法/模型和真实脱敏响应至少两项相互印证后，才把接口标为已确认。

静态分析不包含账号 Cookie、手机号、验证码、播放历史或其它私密会话数据；真实账号写入仍需用户在受控设备上验证。
