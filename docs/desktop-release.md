红果短剧桌面版 0.2.90（macOS / Windows）

- 版本号与 Android、webOS 发行线同步。预约写入后不再同步轮询列表；界面会区分“请求已提交”和“预约列表已确认”，减少等待并避免把未确认状态显示为成功。
- MPV 播放使用可恢复的 Range/CENC 媒体代理，并在适用时预取紧邻下一集的开头；不支持 Range 或预取失败时保留完整文件兜底。
- MPV 切集过渡使用上游返回的本集封面，减少切集时的空白过渡。

macOS 通用 ZIP 支持 Intel / Apple Silicon，最低 macOS 11；Windows x64 需要 Microsoft Edge WebView2 Runtime。
通过设置检查更新并下载 ZIP，退出后手动替换完整程序。账号及本地记录保存在独立用户目录。
未做 Apple 公证或 Windows 代码签名。Windows 实体播放仍待实测。
