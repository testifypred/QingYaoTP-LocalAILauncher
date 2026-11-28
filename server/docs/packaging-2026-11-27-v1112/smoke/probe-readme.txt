=== probe-readme ===
[edge] pid=12896 cdp up
[edge] page ready url=http://127.0.0.1:8099/

== 目标 http://127.0.0.1:8099 / CDP http://127.0.0.1:9333 ==

ok   /api/readme 可用  [HTTP 200]
ok   有正文（> 500 字）  [8852 chars]
ok   正文含项目名
ok   正文含小节标题
ok   带版本号且与 /api/version 一致  [1.11.2]
ok   有产品名  [QingYaoTP AILauncher]
ok   给了正文来源路径  [C:\Temp\qytp-v1112-smoke\QingYaoTP AILauncher-v1.11.2\app\README.md]
ok   onboarding 暴露 readmeShown  [true]
ok   可置为未读  [false]
ok   首次启动自动弹出使用说明
ok   弹窗标题带「使用说明」  [使用说明 · QingYaoTP AILauncher v1.11.2]
ok   正文按 Markdown 渲染（有标题）  [{"heads":17,"tables":7,"len":7448}]
ok   正文渲染出内容（> 500 字）  [7448]
ok   正文含表格（能力/常见问题）  [7]
ok   点「开始使用」后关闭
ok   关闭后服务端记下已读  [true]
ok   再次启动不再自动弹
ok   设置 → 关于 有「使用说明…」按钮
ok   点按钮能重新打开
ok   Esc 能关闭
ok   跑完复位为已读  [true]

RESULT 21/21
[probe] exit=0
