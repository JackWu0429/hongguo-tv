# Android 6 遥控器焦点与首次显示（0.2.3）

0.2.2 已能在用户设备显示真实数据，但方向键没有进入应用的焦点导航。代码中的 keyCode 兜底只包含 Android KeyEvent 常量（19/20/21/22），旧 WebView 传到 JavaScript 的 DOM keyCode 是 38/40/37/39，且 Chromium 44 可能没有 KeyboardEvent.key。

用 0.2.2 源码的 normalizedKey 直接输入四个 DOM 方向键，全部得到空字符串，确认这处兼容缺口。0.2.3 补齐 DOM 键码并保留已有 Android 映射，支持旧名称 Up/Down/Left/Right、keyIdentifier、确认和返回。输入框左右键仍交给原生编辑，不会移走焦点；确认长按不重复提交。

goFocus 不再给旧版 HTMLElement.focus 传 options；页面加载后原生 WebView 重新取得焦点。没有新增第二套方向键导航，也没有改变推荐上下换剧、播放器返回顺序或各页面的区域导航。

原生启动页的 LinearLayout 默认给子项整行宽度，TextView 默认文字左对齐。标题和版本改为 wrap_content 加明确居中，重试按钮同样限定宽度，容器保留对称留白。Android 6 的实际屏幕位置需要用户复测，GitHub 编译/lint 不能代替真机视觉验收。

图片保留现有固定海报框，加载前不显示图片像素，onload 后下一帧再显示；更新图片代次防止旧图片的迟到帧提前显示新图。播放加载海报改为 CSS background-size:cover，预加载完成才显示当前图片，保持比例，不依赖 img 的 object-fit 首帧行为。图片失败不显示破图，播放后隐藏海报的规则保持不变。

20 项 JavaScript 测试覆盖旧 DOM 键码、别名、输入框、长按、海报加载/失败/迟到。浏览器刻意删除旧 WebView 缺失 API 和 event.key、禁用 focus options、启用旧布局样式，在 1280×720 和 1920×1080 验证侧栏、筛选、卡片行列、选集 0→1→13→1→0、关闭面板、退出播放和原卡片继续右移。所有目标可见且无页面 JS 错误。这是模拟验收，不是真实 Android 6 设备验收。
