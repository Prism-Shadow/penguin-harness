# 推送到过旧的 runtime 上会直接失败，而不是只落地半个版本

- **Date:** 2026-08-20
- **Type:** fix
- **Scope:** `server`

把当前的 bundle 推到一台 runtime 早于资源接口握手的机器上，会让它用**新**前端去打**旧** API：
打开「上传限制」时浏览器报 `Cannot read properties of undefined (reading 'attachmentLimitMinMb')`，
因为 `/api/me` 仍然是上一个版本的。

推送本身是原子的——platform、CLI 和 web dist 作为同一个版本一起提交——但它送过去的 platform
必须先**认领** runtime 发布的业务能力，才能服务业务 API。过旧的 runtime 发布不出这些能力，认领
失败，而 platform 当时的处理是降级成一个只有终端的 App：它拒绝了所有业务路由，seam 把这些请求
交还给 runtime，那个更旧的 runtime 就用自己内建的路由回答了它们。于是一次原子推送悄悄地只落地了
半个版本，还报告为成功。

现在，认领不到业务能力的 platform 会拒绝启动。升级按任何一次启动失败的方式整体回滚——正在运行的
版本继续服务，web dist 不提交，什么都不持久化——推送方拿到的是拒绝的原因：需要更新的是这台机器的
安装本身，因为推送替换的是 platform，从来不是 runtime。已经处在半个版本状态的机器同样需要这个更新——
已提交的 bundle 早于这项检查，重启只会把它原样降级恢复；更新安装后，同一个已提交的 bundle 就能认领成功、
完整服务（或者删掉 `<数据根>/hmr/harness.json`，退回打包自带的版本）。

真的没有业务 runtime 的宿主（bare kernel）会明确声明自己是这种宿主，照旧得到只有终端的 platform。
「答不上来」不再被当成「只要终端」。
