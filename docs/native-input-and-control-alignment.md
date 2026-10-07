# 原生数字键盘和旧 WebView 按钮对齐

用户在实体 Android 6 上确认 0.2.10 仍不能用方向键操作系统键盘，而第一版可打开数字键盘并输入。因此不能把浏览器或 InputKeyPolicy 单元测试当作键盘已修好的证据。

0.2.11 以早期可编辑 WebView 输入链路为基线。手机号不再因 Android 导航状态被设为只读，保留账号请求忙碌及验证码阶段号码锁定等业务限制。验证码改用 type=tel；旧 WebView 不必依赖较新的 inputmode 支持，值仍是字符串，保留前导零。

输入区域 focus/click 只登记输入会话。原生桥不 requestFocus、不 restartInput、不 showSoftInput，由 WebView 原本的输入连接处理系统键盘。网页对可编辑账号输入框的方向、确认、数字、删除键直接放行，确认不再切换只读状态、完成输入或触发短信/登录。输入期间原生保留上下键，返回完成及可检测的键盘关闭才恢复页面按钮焦点。账号忙碌和已发送验证码的号码锁定规则不放宽。

播放器按钮外层使用 inline-block；正常 span 内部使用 inline-flex、align-items:center，SVG 与文字各自为 block，图标用固定 20px，间距用 margin。旧 WebView 无需在 button 本身执行 flex 排版。动态文字仍只更新 control-label，不重建按钮或图标。

验收区分网页回归、GitHub 原生 JVM/正式签名构建、实体 Android TV 三类证据。前两项不能替代用户设备的键盘方向与按钮视觉复测。
