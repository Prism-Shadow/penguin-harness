# 未知命令带 --help 时照实报错、退出码非零

Date: 2026-11-01
Type: fix
Scope: cli

[English](./2026-11-01-unknown-command-help.md)

`penguin <词> --help` 过去对任何未具名命令的词都打印顶层帮助并以 0 退出，help 标志后面的错字看起来像一次成功调用。现在未知词与裸调用报同一个错：`[error] unknown command <词>`、指回 `penguin --help` 的用法提示、exit 1。程序本身的 `--help` 与每个真实命令的 `--help` 均不变。
