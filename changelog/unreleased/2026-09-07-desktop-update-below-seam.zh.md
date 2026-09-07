# 客户端更新中继移到热更新接缝之下

- **Date:** 2026-09-07
- **Type:** improvement
- **Scope:** `server`

[English](2026-09-07-desktop-update-below-seam.md)

`/api/desktop/update`——桌面端更新弹窗读写的那套接口——此前挂在平台 HTTP 接缝之上，和宿主命令是同一种错放：谁能看到更新、下载需要什么确认、页面被展示成什么样，这些都是策略，而策略属于靠推送发布的那一层。

现在由平台提供。runtime 保留消息端口，并把 shell 最后一帧更新状态原样发布在 `runtime:shell-frames` 里；平台在读取时解析它，并把 check/download/install 从同一个端口发回去。

`/api/desktop` 的其余部分留在 runtime，而且理应如此：一次性登录 token 与进程自身的停机是机制，不是策略。平台仍然拒绝该前缀，只接管 update 这棵子树。

两条兼容路径与宿主命令那次形状相同：更旧的 runtime 改从它自己的 service 读；runtime 在接缝之下保留一份路由，回滚到仍拒绝该路径的旧平台时，更新弹窗依然可用。
