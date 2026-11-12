/**
 * `penguin browser` — the agent browser, a thin client over /api/builtin-browser in the shape of
 * GenericAgent's web_scan / web_execute_js tools. The browser is the one the user chose for their
 * agents: the desktop app's built-in browser, or their own Chrome through the PenguinHarness
 * Browser extension. The CLI never picks it; `status` names it.
 *
 *   penguin browser status | tabs
 *   penguin browser open <url> [--new-tab] | switch <tab-id> | close [<tab-id>]
 *   penguin browser scan [--text] [--max-chars <n>]
 *   penguin browser exec [<script> | -] [--file <f>] [--save <f>] [--no-monitor] [--timeout <s>]
 *   penguin browser click <selector> [--index <n>] | click --at <x>,<y>
 *   penguin browser type <text> [--selector <css>] [--submit]
 *     (exec, click and type answer the page's dialogs: alerts accepted, the others dismissed
 *     unless --accept-dialogs)
 *   penguin browser screenshot [-o <file.png>] [--full-page]
 *   penguin browser cdp <Domain.method> [--params <json>]
 *   penguin browser import --list | --from <source-id|browser> [--cookies] [--history] [--domain <d>]...
 *   penguin browser history [<query>] [-n <count>]
 *
 * Every command takes `--json` (the response DTO as one line) and `--server`; the commands that
 * act on a page take `--tab <id|active>`, `active` by default. Inside a session,
 * PENGUIN_SESSION_ID travels with every call as `sessionId` — in the body, or the query of a GET
 * or DELETE. The server acts for the person driving that session, so an agent drives its own
 * user's Chrome, and the app shows which conversation is at work. What is printed is
 * browser-output.ts; an error is one line on stderr, `error: <code>: <message>`, with exit code 1.
 *
 * The CLI never auto-starts a server for these commands: the built-in browser lives in the
 * desktop app, and the user's Chrome is paired with the server they signed in to, so a server
 * started here would have neither.
 * Docs: /docs/cli § "penguin browser".
 */

import type { Command } from "commander";
import type {
  BuiltinBrowserExecResult,
  BuiltinBrowserHistoryResponse,
  BuiltinBrowserImportResult,
  BuiltinBrowserImportSourcesResponse,
  BuiltinBrowserScanResult,
  BuiltinBrowserScreenshot,
  BuiltinBrowserStatus,
  BuiltinBrowserTab,
  BuiltinBrowserTabsResponse,
} from "../../api/types.js";
import type { Messages } from "../i18n.js";
import {
  renderCdpResult,
  renderExec,
  renderHistory,
  renderImportResult,
  renderImportSources,
  renderScan,
  renderStatus,
  renderTabs,
  tabHead,
} from "../browser-output.js";
import {
  action,
  connect,
  collect,
  enc,
  invalid,
  normalizeUrl,
  parseIndex,
  parseParams,
  parsePoint,
  parseTimeout,
  positiveInt,
  print,
  printJson,
  readStdin,
  resolveScript,
  resolveSource,
  saveValue,
  session,
  sessionQuery,
  tabRef,
  fileStamp,
  pngSize,
  BASE,
  STDIN_GRACE_MS,
} from "./browser-args.js";
import fs from "node:fs";
import path from "node:path";
import { BrowserCliError, errorText } from "./browser-args.js";
import type { CommonOpts } from "./browser-args.js";

export function registerBrowserCommand(browser: Command, t: Messages): void {
  /** `--json` and `--server`, which every leaf takes, after its own options. */
  const leaf = (cmd: Command): Command =>
    cmd.option("--json", t.common.json).option("--server <url>", t.common.server);
  /** A leaf acting on a page: `--tab` too. */
  const onTab = (cmd: Command): Command => leaf(cmd.option("--tab <id>", t.browser.tab));

  leaf(browser.command("status").description(t.browser.statusDesc)).action(
    action(t, async (opts: CommonOpts) => {
      const client = await connect(opts, t);
      const res = await client.request<BuiltinBrowserStatus>(
        "GET",
        `${BASE}/status${sessionQuery()}`,
      );
      if (opts.json === true) printJson(res);
      else print(renderStatus(res, t));
      if (!res.available) process.exitCode = 1;
    }),
  );

  leaf(browser.command("tabs").description(t.browser.tabsDesc)).action(
    action(t, async (opts: CommonOpts) => {
      const client = await connect(opts, t);
      const res = await client.request<BuiltinBrowserTabsResponse>(
        "GET",
        `${BASE}/tabs${sessionQuery()}`,
      );
      if (opts.json === true) printJson(res);
      else print(renderTabs(res, t));
    }),
  );

  onTab(
    browser
      .command("open")
      .description(t.browser.openDesc)
      .argument("<url>", t.browser.urlArg)
      .option("--new-tab", t.browser.newTab),
  ).action(
    action(t, async (raw: string, opts: CommonOpts & { newTab?: boolean }) => {
      if (opts.newTab === true && opts.tab !== undefined) throw invalid(t.browser.newTabWithTab());
      const tab = tabRef(opts.tab, t);
      const url = normalizeUrl(raw);
      const client = await connect(opts, t);
      const res =
        opts.newTab === true
          ? await client.request<{ tab: BuiltinBrowserTab }>("POST", `${BASE}/tabs`, {
              url,
              activate: true,
              ...session(),
            })
          : await client.request<{ tab: BuiltinBrowserTab }>(
              "POST",
              `${BASE}/tabs/${tab}/navigate`,
              { url, ...session() },
            );
      if (opts.json === true) printJson(res);
      else print(`${tabHead(res.tab, t)}\n`);
    }),
  );

  leaf(
    browser
      .command("switch")
      .description(t.browser.switchDesc)
      .argument("<tab-id>", t.browser.tabIdArg),
  ).action(
    action(t, async (raw: string, opts: CommonOpts) => {
      if (!/^\d+$/.test(raw.trim())) throw invalid(t.browser.positiveInt("<tab-id>", raw));
      const tab = raw.trim();
      const client = await connect(opts, t);
      const res = await client.request<{ tab: BuiltinBrowserTab }>(
        "POST",
        `${BASE}/tabs/${tab}/activate`,
        session(),
      );
      if (opts.json === true) printJson(res);
      else print(`${tabHead(res.tab, t)}\n`);
    }),
  );

  leaf(
    browser
      .command("close")
      .description(t.browser.closeDesc)
      .argument("[tab-id]", t.browser.closeTabArg),
  ).action(
    action(t, async (raw: string | undefined, opts: CommonOpts) => {
      const tab = tabRef(raw, t);
      const client = await connect(opts, t);
      await client.request("DELETE", `${BASE}/tabs/${tab}${sessionQuery()}`);
      if (opts.json === true) printJson({ closed: tab === "active" ? tab : Number(tab) });
      else print(`${tab === "active" ? t.browser.closedActive() : t.browser.closed(tab)}\n`);
    }),
  );

  onTab(
    browser
      .command("scan")
      .description(t.browser.scanDesc)
      .option("--text", t.browser.textOnly)
      .option("--max-chars <n>", t.browser.maxChars),
  ).action(
    action(t, async (opts: CommonOpts & { text?: boolean; maxChars?: string }) => {
      const tab = tabRef(opts.tab, t);
      const maxChars =
        opts.maxChars !== undefined ? positiveInt("--max-chars", opts.maxChars, t) : undefined;
      const client = await connect(opts, t);
      const res = await client.request<BuiltinBrowserScanResult>(
        "POST",
        `${BASE}/tabs/${tab}/scan`,
        {
          ...(opts.text === true ? { textOnly: true } : {}),
          ...(maxChars !== undefined ? { maxChars } : {}),
          ...session(),
        },
      );
      if (opts.json === true) printJson(res);
      else print(renderScan(res, t));
    }),
  );

  onTab(
    browser
      .command("exec")
      .description(t.browser.execDesc)
      .argument("[script]", t.browser.scriptArg)
      .option("--file <file>", t.browser.file)
      .option("--save <file>", t.browser.save)
      .option("--no-monitor", t.browser.noMonitor)
      .option("--timeout <duration>", t.browser.timeout)
      .option("--accept-dialogs", t.browser.acceptDialogs),
  ).action(
    action(
      t,
      async (
        arg: string | undefined,
        opts: CommonOpts & {
          file?: string;
          save?: string;
          monitor?: boolean;
          timeout?: string;
          acceptDialogs?: boolean;
        },
      ) => {
        const tab = tabRef(opts.tab, t);
        const timeoutMs = opts.timeout !== undefined ? parseTimeout(opts.timeout, t) : undefined;
        const script = await resolveScript(arg, opts.file, t);
        const client = await connect(opts, t);
        const res = await client.request<BuiltinBrowserExecResult>(
          "POST",
          `${BASE}/tabs/${tab}/exec`,
          {
            script,
            ...(opts.monitor === false ? { noMonitor: true } : {}),
            ...(timeoutMs !== undefined ? { timeoutMs } : {}),
            ...(opts.acceptDialogs === true ? { acceptDialogs: true } : {}),
            ...session(),
          },
        );
        const savedTo =
          opts.save !== undefined && res.status === "success"
            ? saveValue(opts.save, res.value, t)
            : undefined;
        if (opts.json === true) printJson(res);
        else print(renderExec(res, t, { alwaysReturn: true, savedTo }));
        if (res.status === "failed") process.exitCode = 1;
      },
    ),
  );

  onTab(
    browser
      .command("click")
      .description(t.browser.clickDesc)
      .argument("[selector]", t.browser.selectorArg)
      .option("--index <n>", t.browser.index)
      .option("--at <x,y>", t.browser.at)
      .option("--accept-dialogs", t.browser.acceptDialogs),
  ).action(
    action(
      t,
      async (
        selector: string | undefined,
        opts: CommonOpts & { index?: string; at?: string; acceptDialogs?: boolean },
      ) => {
        const tab = tabRef(opts.tab, t);
        const byPoint = opts.at !== undefined;
        if ((selector === undefined) !== byPoint || (byPoint && opts.index !== undefined)) {
          throw invalid(t.browser.clickTarget());
        }
        const target = byPoint
          ? parsePoint(opts.at!, t)
          : {
              selector: selector!,
              ...(opts.index !== undefined ? { index: parseIndex(opts.index, t) } : {}),
            };
        const client = await connect(opts, t);
        const res = await client.request<BuiltinBrowserExecResult>(
          "POST",
          `${BASE}/tabs/${tab}/click`,
          {
            ...target,
            ...(opts.acceptDialogs === true ? { acceptDialogs: true } : {}),
            ...session(),
          },
        );
        if (opts.json === true) printJson(res);
        else print(renderExec(res, t, { alwaysReturn: false }));
        if (res.status === "failed") process.exitCode = 1;
      },
    ),
  );

  onTab(
    browser
      .command("type")
      .description(t.browser.typeDesc)
      .argument("<text>", t.browser.textArg)
      .option("--selector <css>", t.browser.selector)
      .option("--submit", t.browser.submit)
      .option("--accept-dialogs", t.browser.acceptDialogs),
  ).action(
    action(
      t,
      async (
        text: string,
        opts: CommonOpts & { selector?: string; submit?: boolean; acceptDialogs?: boolean },
      ) => {
        const tab = tabRef(opts.tab, t);
        const client = await connect(opts, t);
        const res = await client.request<BuiltinBrowserExecResult>(
          "POST",
          `${BASE}/tabs/${tab}/type`,
          {
            text,
            ...(opts.selector !== undefined ? { selector: opts.selector } : {}),
            ...(opts.submit === true ? { submit: true } : {}),
            ...(opts.acceptDialogs === true ? { acceptDialogs: true } : {}),
            ...session(),
          },
        );
        if (opts.json === true) printJson(res);
        else print(renderExec(res, t, { alwaysReturn: false }));
        if (res.status === "failed") process.exitCode = 1;
      },
    ),
  );

  onTab(
    browser
      .command("screenshot")
      .description(t.browser.screenshotDesc)
      .option("-o, --output <file>", t.browser.output)
      .option("--full-page", t.browser.fullPage),
  ).action(
    action(t, async (opts: CommonOpts & { output?: string; fullPage?: boolean }) => {
      const tab = tabRef(opts.tab, t);
      const client = await connect(opts, t);
      const res = await client.request<BuiltinBrowserScreenshot>(
        "POST",
        `${BASE}/tabs/${tab}/screenshot`,
        { ...(opts.fullPage === true ? { fullPage: true } : {}), ...session() },
      );
      if (opts.json === true && opts.output === undefined) {
        printJson(res);
        return;
      }
      const png = Buffer.from(res.data, "base64");
      const target = path.resolve(opts.output ?? `screenshot-${fileStamp()}.png`);
      try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, png);
      } catch (err) {
        throw new BrowserCliError("io_error", t.browser.fileUnwritable(target, errorText(err)));
      }
      if (opts.json === true) printJson(res);
      else {
        const size = pngSize(png) ?? res.mime;
        const kilobytes = Math.max(1, Math.round(png.length / 1024));
        print(
          `${t.browser.line(t.browser.label.screenshot, t.browser.screenshotSaved(target, size, kilobytes))}\n`,
        );
      }
    }),
  );

  onTab(
    browser
      .command("cdp")
      .description(t.browser.cdpDesc)
      .argument("<method>", t.browser.methodArg)
      .option("--params <json>", t.browser.params),
  ).action(
    action(t, async (method: string, opts: CommonOpts & { params?: string }) => {
      const tab = tabRef(opts.tab, t);
      if (!/^[A-Za-z]+\.[A-Za-z]+$/.test(method)) throw invalid(t.browser.methodInvalid(method));
      const params = opts.params !== undefined ? parseParams(opts.params, t) : undefined;
      const client = await connect(opts, t);
      const res = await client.request<{ result: unknown }>("POST", `${BASE}/tabs/${tab}/cdp`, {
        method,
        ...(params !== undefined ? { params } : {}),
        ...session(),
      });
      if (opts.json === true) printJson(res);
      else print(renderCdpResult(res.result, t));
    }),
  );

  leaf(
    browser
      .command("import")
      .description(t.browser.importDesc)
      .option("--list", t.browser.list)
      .option("--from <source>", t.browser.from)
      .option("--cookies", t.browser.cookies)
      .option("--history", t.browser.history)
      .option("--domain <domain>", t.browser.domain, collect, []),
  ).action(
    action(
      t,
      async (
        opts: CommonOpts & {
          list?: boolean;
          from?: string;
          cookies?: boolean;
          history?: boolean;
          domain: string[];
        },
      ) => {
        if ((opts.list === true) === (opts.from !== undefined))
          throw invalid(t.browser.importMode());
        const client = await connect(opts, t);
        if (opts.list === true) {
          const res = await client.request<BuiltinBrowserImportSourcesResponse>(
            "GET",
            `${BASE}/import/sources${sessionQuery()}`,
          );
          if (opts.json === true) printJson(res);
          else print(renderImportSources(res.sources, t));
          return;
        }
        const sourceId = await resolveSource(client, opts.from!, t);
        // Neither flag means both: an import brings everything unless told otherwise.
        const both = opts.cookies !== true && opts.history !== true;
        const res = await client.request<BuiltinBrowserImportResult>("POST", `${BASE}/import`, {
          sourceId,
          cookies: both || opts.cookies === true,
          history: both || opts.history === true,
          ...(opts.domain.length > 0 ? { domains: opts.domain } : {}),
          ...session(),
        });
        if (opts.json === true) printJson(res);
        else print(renderImportResult(res, t));
      },
    ),
  );

  leaf(
    browser
      .command("history")
      .description(t.browser.historyDesc)
      .argument("[query]", t.browser.queryArg)
      .option("-n, --count <count>", t.browser.count),
  ).action(
    action(t, async (query: string | undefined, opts: CommonOpts & { count?: string }) => {
      const limit = opts.count !== undefined ? positiveInt("-n", opts.count, t) : 20;
      const client = await connect(opts, t);
      const res = await client.request<BuiltinBrowserHistoryResponse>(
        "GET",
        `${BASE}/history?q=${enc(query ?? "")}&limit=${limit}${sessionQuery("&")}`,
      );
      if (opts.json === true) printJson(res);
      else print(renderHistory(res.entries, t));
    }),
  );
}
