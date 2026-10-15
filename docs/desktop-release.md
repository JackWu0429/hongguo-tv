红果短剧桌面版 0.2.68（macOS / Windows）

- 优化 HTML5 同剧切集过渡：尽量保留上一集最后一帧，新视频就绪后再切换；取帧失败时保留黑色兜底。
- 从卡片进入播放并看完最后一集后，在没有可续播下一季时，底部展示本剧相关推荐。支持鼠标点击、左右键选择和横向滚动，Escape 收起推荐行；保留预约与自动续播优先级。
- macOS 通用 ZIP 支持 Intel / Apple Silicon，最低 macOS 11；Windows x64 需要 Microsoft Edge WebView2 Runtime。
- 桌面版通过独立更新清单检查并下载 ZIP，安装仍由用户手动替换程序文件。
- 未做 Apple 公证或 Windows 代码签名。
