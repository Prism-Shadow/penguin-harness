# The Web App shows an Agent plugin's server module and lets it be enabled or asked for

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `web`, `ui-gallery`

[中文版](2026-11-19-plugin-module-on-agent-install-web.zh.md)

The Web App follows the server's new rule for a plugin that also ships server modules ([PRFC-0031](https://github.com/Prism-Shadow/penguin-harness-design/pull/479), server side in [#1636](https://github.com/Prism-Shadow/penguin-harness/pull/1636)). An install says in its toast what became of the module. An Agent's plugin row marks a module that does not run on the Agent's server and offers what the viewer can do about it. The administrator decides members' requests in Settings › Plugins.

## Details

- On the Agent settings Plugins sub-page, a plugin the Agent carries whose module does not run gets a second mark after its status: off, awaiting the administrator, stopped by the administrator, failed to load, or waiting for a restart, each explained on hover. While the module is off the row offers 「启用服务端模块」 (a built-in plugin, or the viewer is the administrator) or 「请求管理员启用」. The administrator can also enable a module that waits or was stopped. The detail's 「在这个 Agent 上」 section has a 「服务端模块」 line with the same state, including running, and the same action. An Agent that already carried such a plugin before this change shows the mark and the button; nothing is enabled by itself.
- An install's toast, on the Plugins page and on the Agent's settings, adds what became of the module: enabled, asked of the administrator, stopped by the administrator, or failed to start.
- A machine's Agent is installed with `skipModules`, since the hub keeps that machine's plugin list. When the machine reports the module off and its own build ships the package, the hub lists the module for that machine with the existing install route, and reads the Agent again at once and three seconds later. Otherwise the toast says to install it for that machine on the Plugins page. Goal mode's install and the import dialog's porting Skill go through the same path.
- Settings › Plugins has a 「服务端模块请求」 section under the divider, first among the server's options and following the machine picker. Each row is one line: the plugin, how it stands, the Project, who asked and when. A waiting row offers 「启用」 and 「拒绝」, and only 「拒绝」 once its Project is gone. An enabled row names how it was enabled (内置自动, 管理员 or 已批准) and offers 「停用」, which asks first. A declined row offers 「启用」. A stop that leaves the module running because a Project's shared table still lists it names those Projects.
- The Plugins page shows the administrator 「N 个服务端模块等待启用」 with 「查看」 beside the incompatible-plugin notices, and the Plugins nav dot counts those requests too. A hybrid plugin's card reads 「待启用」 or 「已停用」 while an ask for its module stands and the module does not run.
- `plugin_modules_changed` makes the Agent's plugin page, the Plugins page and the request list read again, without a toast.
- The small print of the server-module install and remove confirmation, and of the import dialog, now says that running Agents are not affected by the reload.
- The ui-gallery mock answers the three new endpoints and carries `modules` on the Agent's plugins and the installed plugins.
