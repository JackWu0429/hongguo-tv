# 非大陆手机号登录：v1.2.4 实际包对照

核验日期：2026-10-18。对照我方基线：v0.2.80 / 959d13893510463b3fed2c9738f48ca65eac9a59。

## 来源及证据边界

参考 [hongguo-player v1.2.4](https://github.com/yangbin1322/hongguo-player/releases/tag/v1.2.4) 的实际 macOS universal 资产 `hongguo-v1.2.4-macos-universal.zip`，大小 19,361,503 bytes，SHA256：

```
d8e8eaf5cc6f5fa61101be90bb2e520fa83248dab46239f66d02cc5c10bcc13b
```

包内为 Go 1.25.0 / Wails v2.11.0，amd64 + arm64 universal。以下地址均为该包 arm64 slice 的虚拟地址，结合 Go pclntab、反射类型布局和指令读取，不依据 `strings` 相邻预览推断字段值。已提取实际前端 Login 组件，并在实际应用查看 +852 区号及 App 验证码说明，没有向真实号码发码或提交验证码。

这些证据能确认客户端实现差异，不能确认它们就是所有登录失败的原因，也不能证明境外号码已经端到端登录成功。测试中的成功响应全部来自本机隔离服务器；固定签名向量来自按指令还原的独立 Python RC4 计算，**不是上游成功请求抓包**。

## 已确认的请求差异

| 环节 | 包内证据 | 本次处理 |
| --- | --- | --- |
| 号码序列化 | `mobileWithCode` 0x1003bdcd0；`formatLocal` 0x1003c0c20 | 非 +86 本地号按地区最大长度分组，加空格后再 XOR5/hex；内部账号身份仍用紧凑 E.164 |
| 发码 / 登录 | `SendCode` 0x1003bd5a8、`SMSLogin` 0x1003be1a8 调用上述格式化路径 | 两处都使用同一序列化函数 |
| 签名选择 | `Login.call` 0x1003bdaf0，0x1003bdbec 写 API.Mode=4；Mode 在 API 偏移 64 | 仅非 +86 登录请求选独立策略，模式不保存在共享客户端上 |
| 签名头 | `Signer.Sign` mode=4 分支 0x1003a8708 | Gorgon / Helios / Argus / Ladon / Khronos / Req-Ticket / Trace-Id，有 body 时带 Stub，无 Medusa |
| Gorgon | `xgorgonWith` 0x10039fbe0；mode=4 传函数值 0x100feeee0，其入口为 `rc4Gorgon` 0x10039fa40 | 标准 RC4 KSA/PRGA 均交换 S 表；保留原 full 模式算法 |
| 时间戳头 | 0x1003a882c–0x1003a8878 | Argus 为秒级 uint32 小端 4 字节 Base64，Ladon 为大端；这是参考包此分支行为，不是通用 Argus/Ladon 算法 |
| Trace | `NewTraceID` 0x1003a8eb0 | 保留该包的毫秒前缀、`10` 和随机十六进制格式 |
| 二次验证 | `UpsmsVerify` 经同一个 `Login.call` | 上行短信验证与验证后重试也按当前号码选模式 |

接口和 POST 表单维持现有流程：`/passport/mobile/send_code/v1/`、`/passport/mobile/sms_login/`、`/passport/upsms/verify/`。本次没有增加端点或绕过验证码校验。App 验证码兜底仍是用户在官方 App 获取验证码后提交同一个登录接口。

Gorgon 输入 20 字节依次为 query MD5 前 4 字节、body MD5 前 4 字节（空 body 为 0）、4 字节 0、常数 67503104 的小端、秒级时间戳的大端。RC4 key 为 `4a 40 16 nonceHi 47 6c 01 nonceLo`，随后按指令做 nibble 旋转、相邻 XOR、位反转和补码，头为 `84 04 nonceLo nonceHi 40 01`。固定向量放在 `core/cmd/hongguotv/testdata/passport-international-v124.json`，独立计算器用 RFC 6229 的 RC4 向量校验基础流。

## 号码长度及分组

参考包静态地区 slice 位于 0x10168cd40，指向 0x1016a8a80，共 14 项；Region 的 Min/Max 分别在偏移 48/56。其长度规则为：

| 区号 | 本地号码位数 |
| --- | --- |
| +86 | 11 |
| +852 / +853 / +65 | 8 |
| +886 / +60 / +95 / +84 | 9–10 |
| +62 | 10–13 |
| +63 | 7–10 |
| +855 | 8–9 |
| +81 | 9–11 |
| +82 | 8–11 |
| +971 | 9 |

非大陆分组依据 Max：10 用 3/4/3，11 用 3/4/4，可被 4 整除则每组 4 位，其余每组 3 位，尾组可不足。区号后不另加空格。例如合成输入 `+85261234567` 的发送原文是 `+8526123 4567`，不是把空格只用于显示。

Go、TV 数字键盘和手机辅助输入共用相同长度政策，保留号码与验证码的前导零。参考包还会请求官方 settings 的地区表；本次仅对齐其已核实的静态表，没有新增启动联网依赖。

## 验证范围

回归覆盖：14 地区输入及发送字节；独立固定签名向量；实际 URL / body 与签名绑定；同一客户端非大陆→大陆→非大陆不串模式；发码失败后的 App 验证码输入、MFA 和重试；原大陆签名及现有登录生命周期测试。

本次不改变大陆签名、设备注册、已登录账号业务接口或视频解析签名。Android TV、macOS、Windows 复用该 Go 核心；webOS 当前不提供账号登录，媒体签名没有改动。

上线前仍需真实境外号码确认发码、收码、提交验证码、可能的挑战及最后的会话身份。若官方 App 取码后提交失败，还需核查验证码是否绑定发码设备，不能由模拟测试宣布该兜底必然成功。
