# 账号登录与云同步

2026-10-07。独立 Android TV APK 的账号能力由内置 Go 核心提供，不依赖 8787、57828 或其它签名服务。

## 使用方式

侧栏进入“我的 / 登录”，输入手机号并获取验证码，填写验证码后登录。发码有倒计时，可以“换手机号”。红果如果要求进一步短信验证，页面展示本次响应中的收件号码和短信内容；使用登录的手机号发送后，选择“我已发送”。每 3 秒检查一次，最多等待 90 秒，可以取消或按返回。没有写死截图中的号码或短信内容。

登录成功后可查看当前账号及云同步状态，左右键可在账号和同步两栏之间切换。“立即同步”主动触发一轮同步，退出前有确认弹窗。验证码错误、接口失败、验证等待和同步失败分别显示，不把等待或 HTTP 200 当作成功。

## 记录与合并

- 未登录时继续使用原 `library.json`。登录后使用 `accounts/<uid>/library.json`，不同账号互相隔离；登录前的记录不会自动上传。退出后返回原本机记录，再次登录同一账号会恢复该账号的待同步队列。
- 云端收藏、历史、进度通过官方接口读取；收藏列表只提供 ID，缺少剧名时以最多 4 个并发补详情。历史最多读取 5 页、每页 100 条，超限或结构错误会报告同步未完成。保留本机历史 200 部、收藏/点赞各 300 部的显示上限。
- 同步先完整读取云端，再按观看更新时间合并。本机未上传的收藏操作优先保留；云端进度较新时舍弃对应旧进度操作，本机更新较新时再上传。设备时钟应正常，判断不依赖标题或集号大小。
- 取消收藏及收藏列表里删除单项会提交云端取消收藏。清空本机列表、删除本机历史不批量删除云端；使用本机排除标记防止下次立即重现，最多保留 2000 个标记，超限淘汰最早的标记。再次播放或收藏会解除对应排除标记。点赞仅保存在本机。
- 同一剧的同类操作合并为最新待上传记录，最多 2000 项。本机记录和队列原子保存；历史及进度两次上报都确认成功后才清除该进度操作。同步失败、写盘失败、旧请求确认不会丢弃更新的操作。自动同步在记录变化后延迟 2 秒触发，另每 90 秒检查一次；单轮总时限 3 分钟。
- 页面写入携带当前 owner，服务器拒绝其它账号的迟到写入；退出取消当前同步，旧登录/同步回复不能恢复已退出的账号。

## 已核对的上游协议

主机 `https://api5-normal-lq.fqnovel.com`。从 Mac v1.1.5 的静态 API 注册表、定点反汇编和 Go 反射标签核对：

| 功能 | HTTP 接口 |
| --- | --- |
| 获取验证码 | POST `/passport/mobile/send_code/v1/` |
| 短信登录 | POST `/passport/mobile/sms_login/` |
| 上行短信验证 | POST `/passport/upsms/verify/` |
| 用户信息 | GET `/reading/user/info/v1/` |
| 历史读取 / 更新 | GET `/reading/bookapi/read_history/list/v` / POST `/reading/bookapi/read_history/update/v` |
| 进度读取 / 上传 | POST `/reading/bookapi/read_progress/get/v` / POST `/reading/bookapi/read_progress/upload/v` |
| 收藏读取 / 更新 | GET `/reading/bookapi/bookshelf/video/list/v` / POST `/reading/bookapi/bookshelf/video/update/v` |

手机号加 `+86` 后 XOR 0x05、hex 编码；验证码同样编码。MFA ticket 后重试短信登录。`vid_index` 按一基集数，UI 的秒转换为上游毫秒。所有 19 位 ID 在 Go/页面保持字符串，上游要求数字的字段用 `json.Number` 编码，避免 float64 丢精度。

历史响应使用 `data.data_list`、`has_more`、`next_offset`；收藏使用 `data.video_shelf_info[].series_id`。进度读取支持原版的顶层 `video_data`，不强制包在 `data` 内。更新必须明确 `code=0`，同时拒绝内部 `error_code` 非零。

签名包含 SM3、F13 branch2、modified MD5、Helios/SPECK、modified RC4 Gorgon、protobuf、XMXOR 和 AESV3/Medusa。以 `_rticket` 毫秒值选择 branch2，四种 AESV3 timestamp 分支均有固定向量测试。协议静态常量与发布版二进制核对；实现独立于已经稳定的媒体解析签名。没有把外部参考 Python 或发布版二进制纳入 APK。

会话以 0600 原子写入 `account.json`，只保留掩码手机号，不保存验证码。账号/记录接口限制回环连接、回环 Host 和同源页面访问，不使用 wildcard CORS。Android 禁用应用备份。退出清除 Cookie/Token，保留稳定设备身份及该账号记录。

## 验证范围

Go race/vet、签名固定向量、登录/MFA fixture、双向同步字段、进度冲突、失败保留队列、账号隔离、退出取消和写盘失败测试已完成。浏览器验证 1280×720 与 1920×1080 的账号界面、输入删除、方向键、等待/取消及退出焦点。

只读匿名用户接口返回 `code=0`，证明取得有效响应，不能代替真实账号验收。尚未向真实号码发码、登录或写入真实账号；服务端设备注册/风控和上行短信号码的可用性仍需在 APK 中验证。验证码只在 APK 输入，不需要发送到聊天。真实 Android TV 遥控器、输入法及账号跨设备同步也仍待设备验收。

本地浏览器 fixture：`HONGGUO_ACCOUNT_UI_FIXTURE=1 go test ./core/cmd/hongguotv -run TestAccountBrowserFixture -v -timeout 30m`，访问 `http://127.0.0.1:18797/`。仅测试文件提供此入口，不进入 APK；测试手机号/验证码与短信内容是 fixture，不能用于真实登录。
