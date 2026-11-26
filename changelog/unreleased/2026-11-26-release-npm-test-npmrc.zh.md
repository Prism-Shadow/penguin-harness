# npm 发布 job 的测试套件改在空的 npm 用户配置下运行

- **Date:** 2026-11-26
- **Type:** process
- **Scope:** `ci`
- **PR:** [#1881](https://github.com/Prism-Shadow/penguin-harness/pull/1881)

[English](2026-11-26-release-npm-test-npmrc.md)

`release.yml` 的 `Publish npm packages` job 改为在空的 npm 用户配置下运行 `scripts/release-npm.sh test`，与 CI 的测试 job 一致：仅对这一条命令，把 `NPM_CONFIG_USERCONFIG` 指向 `$RUNNER_TEMP` 下的一个空文件。此前这些测试套件继承 `actions/setup-node` 为 `registry-url` 写入的 `.npmrc`，其中的 `always-auth` 一行让 npm 每次运行都先输出一条警告。构建与发布步骤仍使用 setup-node 写入的文件，可信发布的配置与原先相同。
