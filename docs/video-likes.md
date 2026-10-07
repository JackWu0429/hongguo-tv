# 短剧真实点赞

2026-10-07。此项为独立 TV APK 的当前集点赞，评论点赞仍使用独立的 commentapi 协议。

## 请求与账号记录

- `POST /api/v1/library`，`action=like`，携带字符串 `owner_id`、精简 `drama`、当前 `video_id`、`episode`、布尔 `value`。要求登录；缺少当前集、账号切换和上游失败均不修改本机点赞状态。
- 上游 `POST /novel/articleapi/do_action/v1/`。核对 Mac v1.1.6 `App.SetLike` → `Library.SetLike` → `Client.SetLike` 的参数顺序：`object_id` 是当前 VID，`business_param.video_id` 是 series ID；`action_category=1`、`object_type=6`、`action_type=3` 点赞 / `4` 取消、`action_reason_remark=like_click`；业务字段 `book_id=0`、`has_aigc_content=false`、`modify_count=0` 及 `shark_param`。
- 只接受明确成功 code=0，或原版明确识别的幂等状态 101045/101046；缺少状态、嵌套错误及网络失败不冒充成功。不自动重试写请求，不把旧的本机点赞批量上传。
- 每部剧保存 `liked_videos:[{video_id,episode,liked_at}]`，`liked_at` 为这部剧最近点赞时间。播放器按当前 VID 高亮，点赞第5集不让第6集显示已点赞；取消一集保留其它已赞集。点赞栏目按剧聚合卡片，历史与继续播放进度独立。

## 真实列表与静态证据的差异

账号列表使用 `GET /reading/ugc/action/mget/v`，`object_type_list=6,15,10`、`action_type=3`、`offset`、`count=100`。Mac v1.1.6 静态 `Likes` 方法的 `action_type=1` 在本次真实账号返回空列表，不能照抄或用它清空账号记录；即便写请求已确认、详情当前集 `user_digg=true`，该旧查询仍为空。真实 action_type=3 返回现有单集点赞，并能读回本轮新增和取消。

完整读取 `mixed_data_list[].video_data`，保持 series ID、VID 的整数精度；从 `video_detail` 获取卡片资料，官方 `user_digg_timestamp_ms` 获取时间。不同 object type 跳过，视频身份不一致则拒绝快照。用服务端 `next_offset`；缺失/不前进时采用原版100步长。有效空 `mixed_data_list:null,has_more:false` 与缺字段、重复页、空但仍有更多严格区分。失败不抹掉已保存点赞。

账号定期同步包含点赞；同步读取中发生点赞写入时，通过 revision 阻止旧快照覆盖新状态。账号切换/退出用既有 generation 隔离，迟到写响应不进入当前库。登录前记录保持独立。栏目中的移除/清空仍只隐藏本机卡片，不批量取消账号单集点赞；播放器按钮才取消当前集的真实点赞，再次点赞解除本机排除标记。

## 验证

- 真实已登录会话：读取列表；为原先未点赞的公共剧集执行点赞，验证出现在账号列表，再取消并确认恢复原状态。未取消用户已有点赞，没有读取或输出凭证、手机号、UID 或私人剧库明细。
- Go fixture：签名/登录凭证、精确字段/大整数、幂等状态和失败、完整分页/重复页/无效快照、按集保存/重启、账号切换迟到响应、云合并保留历史/收藏/本机隐藏。
- 隔离浏览器：作者行删除、点赞/取消回显、失败不变、焦点恢复、换集独立状态、游客不发请求；Go race/vet、JS和分页检查。
- APK 仍只由 GitHub Actions 构建；实体 Android TV 与不同 WebView 的遥控器及长播未在本轮验收。
