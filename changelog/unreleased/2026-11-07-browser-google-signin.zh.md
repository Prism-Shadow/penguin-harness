# 桌面版：内置浏览器可以登录 Google 账号了

- **Date:** 2026-11-07
- **Type:** fix
- **Scope:** `desktop`
- **PR:** [#1505](https://github.com/Prism-Shadow/penguin-harness/pull/1505)

[English](2026-11-07-browser-google-signin.md)

在桌面版的内置浏览器里登录 Google 账号，输完邮箱就会停在「无法登录。此浏览器或应用可能不安全」。原因是内置浏览器对所有站点都自称普通 Chrome，而 Google 登录会拒绝自称 Chrome、其他特征却对不上的浏览器。现在 Google 登录页看到的是 Electron 原样的 UA，如实说明自己是什么浏览器；其他站点看到的仍是 Chrome 的 UA，与以前相同。

## 细节

- 标签页的主框架停在 `accounts.google.com` 或 `accounts.youtube.com` 上时，该标签页使用 Electron 原样的 UA：它发出的请求带这个 UA，页面里的 `navigator.userAgent` 也是它。一离开这两个域名，就换回 Chrome 的 UA。
- client hints（`Sec-CH-UA*`、`navigator.userAgentData`）在所有页面上都保持 Chromium 自己的值，从不改写。
- UA 在主框架导航开始时切换。进出 Google 登录的服务端重定向（例如站点的「使用 Google 账号登录」按钮，或登录完成后 Google 跳回站点）会被取消，再从重定向的目标地址重新发起，落地的页面从第一个请求起就带着对应的 UA。
