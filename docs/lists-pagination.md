# 栏目接口与统一滚动加载

2026-10-07，独立 TV APK 0.2.0-dev。本轮未改 Lampa 插件、8787 或 57828，APK 继续由 GitHub Actions 编译。

## 已接入接口

| 功能 | 上游接口 | TV 本地接口 | 分页方式 |
| --- | --- | --- | --- |
| 找剧、分类、筛选 | POST `/reading/distribution/category/landpage/v/` | `/api/v1/category` | next_offset、session_id、已显示 ID |
| 排行榜 | GET `/reading/bookapi/bookmall/cell/change/v` | `/api/v1/lists/rank` | 首批 tab_type=26、后续=18，服务器游标 |
| 新剧 | GET `/reading/bookapi/bookmall/cell/change/v1/` | `/api/v1/lists/new` | cell=7431550523368554558，服务器游标 |
| 上新日历 | GET `/reading/user/subscribe/list/v1/` | `/api/v1/lists/calendar` | 官方日期、next_offset、subscribe_offset |
| 我的预约 | 同上，tab_type=13 | `/api/v1/lists/reservations` | 已上线/待上线分别请求，要求登录 |
| 预约/取消预约 | POST `/reading/bookapi/search/uncover_subscribe/v` | POST `/api/v1/reservation` | 预约 item_id，op_type=1/2 |
| 推荐四频道 | GET `/reading/bookapi/bookmall/tab/v` 与 `/reading/bookapi/bookmall/cell/change/v` | `/api/v1/lists/recommend` | 关注=45、漫剧=36、真人剧=39、推荐=16；tab→cell 阶段 |
| 当前集评论 | GET `/novel/commentapi/comment/list/{vid}/v1/` | `/api/v1/comments` | 原样传递 JSON 字符串 cursor |
| 当前集弹幕 | 同上 | `/api/v1/danmaku` | 当前时间的 30 秒窗口 |
| 评论楼中楼 | POST `/novel/commentapi/reply/list/{comment_id}/v1/` | GET `/api/v1/replies` | comment_source=504、count=10、原始 cursor |
| 关键词搜索 | GET `/reading/bookapi/search/tab/v`；官网 `/search/{query}` | `/api/v1/lists/search` | search_id/passback/offset；首批失败回退网页 |
| 历史、收藏、点赞 | 既有本机库/账号同步 | `/api/v1/library` | 已保存数据每 20 条渐进显示 |

榜单分类、子榜和筛选由 cell_selector 构造。演员项展示演员，不当作短剧播放。日历日期由 calendar_schema 提供，区分已上线/待上线；待上线不可播放，item_id=0 不可预约。

推荐使用 video_data[].video_detail 和该剧 first_vid 播完整剧，跳过广告、禁播和零集内容。非默认频道首次 tab/v，再用返回的 cell/plan 进入 cell/change，offset 此时可以为 0。因此不能只按 offset 递增判断翻页。关注只读取关注内容 cell（show_type=648），不混入推荐演员（647）。

评论 comment_source=4、server_channel=18、comment_type=4；弹幕分别为 601、1000、20。URL 中必须使用当前集 VID：使用 comment_type 会得到有效但空的列表。保持字符串 ID 精度，不传浮点大整数。

## 统一分页与焦点

ui/pagination.js 共用控制器负责请求去重、参数快照、generation/AbortController、游标、ID 去重、缓冲和错误重试。评论保留不透明 cursor，推荐保留 cell/plan 阶段。没有“加载更多”按钮，只有错误后的“重试”。

- 距离可见底部约 280px 时追加；推荐剩余 3 项时只加载卡片数据。
- 每次追加最多 20 项，保留已有 DOM。普通滚动加载不移动焦点。
- 遥控器在末行按下，只有返回时仍为原页面和原焦点，才移动到同列下一行。
- 切换筛选、日期、页面或账号取消旧回复；播放返回保留 DOM 和滚动位置。
- 失败保留当前内容和游标，显式重试原页；游标停滞或连续三批无新项目时停止。
- 本机历史、收藏/点赞不设总量上限，每 20 条滚动显示。既有云历史同步本身已有服务器游标循环。

账号预约/关注要求登录。复制会话后在锁外联网，回复检查 generation。退出/切换账号会清旧列表。评论侧面板限定焦点，关闭返回评论按钮。弹幕开启且前台播放才读取当前窗口，暂停动画、seek/换集清旧数据，最多同屏 8 条；不提前解析下一集媒体。

## 验证与限制

只读匿名真实测试：新剧 20→20，热播榜 12→20，演员榜 20→20，系列新季榜 10→20，推荐 cell 页和真人剧的 tab→cell 阶段均有效。漫剧后续页有时有效返回空页/不前进游标，按上游结束，不循环。日历原始条数和 next_offset 不一定相同，不能用可见条数代替游标。第十三季样本的评论取得两页各 20 条，弹幕 30000→60000ms 窗口有效。

Go 和 Node 测试覆盖字段、ID 精度、预约成功确认、账号隔离、数字/评论/推荐游标、重叠、迟到回复、并发、失败原页重试和空页停止。1280×720、1920×1080 浏览器 fixture 验证列表追加不重建 DOM、慢搜索不覆盖新搜索、重试焦点、取消预约焦点、播放返回原卡片及滚动位置、筛选入口、评论返回、弹幕开关/seek。

仍待接入或实测：

- 匿名 App 搜索当前 HTTP 200 空响应，保留官网搜索。官网没有已确认的远程分页契约，只展示真实返回的单批结果。
- 真实账号关注、预约写入、登录风控和跨设备同步需要 APK 验收；本轮没有发送短信或写真实云端，fixture 不等于真实账号验证。
- 评论发表/回复/点赞/本人删除、弹幕发送及手动清晰度已接入，协议与验证范围见 [播放操作](player-actions.md)。真实账号写入仍待验收。
- 弹幕点赞、演员主页、关注写操作、下载管理、找剧长度筛选及打赏尚未实现，不用其它数据冒充。
- 实体 TV 遥控器、不同 WebView 和长时间播放按此前约定暂缓。

证据来自 Mac v1.1.5 静态注册表、Go 类型与反汇编；二进制 SHA256 为 72d00b6af7bb69ea9cfb61344ce4592c9f5ba8c404fde5029aaf89a7713dd22d。原始响应与二进制保留在仓库外，不提交账号或设备身份信息。
