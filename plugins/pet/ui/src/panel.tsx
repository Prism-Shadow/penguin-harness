/**
 * The pet's dialog: everything about her in one place, drawn with the shared UI package
 * (`@prismshadow/penguin-ui`) — the same components, tokens and theme the Web App draws its own
 * pages with, so she looks like part of the app instead of a hand-painted panel beside it.
 *
 * What it holds is what the board asked a shop window for: the daily签到 and the daily Token
 * usage of this install (a contribution graph, one cell per day) on the left, her state and the
 * shop on the right, and her habits — how often she talks, how much of the page she roams —
 * underneath them, where the old right-click menu used to keep them.
 *
 * widget.js owns her state and loads this module on the first right-click, so nothing here costs
 * anything until the dialog is asked for. It hands the module a snapshot and the actions to call
 * (types.ts), and is told back when the dialog closed itself.
 */
import "./panel.css";
import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BOOT_SCRIPT } from "@prismshadow/penguin-ui/boot";
import {
  Button,
  Card,
  CardHeader,
  Modal,
  Pill,
  ProgressBar,
  Segmented,
  StatTile,
} from "@prismshadow/penguin-ui";
import type { PetPanel, PetPanelHost, PetSnapshot, ChoiceOption } from "./types";
import { TALK_OPTIONS, AREA_OPTIONS } from "./types";
import type { DayUsage } from "./usage";
import { addDays, formatTokens, heatLevel, localDay, readDailyUsage } from "./usage";

/** How many weeks of daily usage the graph draws — half a year, which fits beside her state. */
const WEEKS = 26;

/** One cell per level, from "nothing that day" to the window's busiest day. */
const CELL_FILL = [
  "var(--ui-inset)",
  "color-mix(in oklab, var(--ui-accent) 20%, var(--ui-surface))",
  "color-mix(in oklab, var(--ui-accent) 40%, var(--ui-surface))",
  "color-mix(in oklab, var(--ui-accent) 65%, var(--ui-surface))",
  "var(--ui-accent)",
] as const;

/**
 * The app's theme, read from the store the app writes it to: this document is same-origin with
 * the Web App and framed by it, so `penguin.theme` and friends are the same values the page
 * behind is wearing. The package's own pre-paint script is the one that maps them onto <html>
 * (mode class, theme id, accent, text size) — run here, before the first render, so the dialog
 * is drawn in the app's theme rather than flashing the default one.
 */
let themeApplied = false;
function applyStoredTheme(): void {
  if (themeApplied) return;
  themeApplied = true;
  const script = document.createElement("script");
  script.textContent = BOOT_SCRIPT;
  document.head.append(script);
  script.remove();
}

/** The last seven days, oldest first, and which of them the current streak covers. */
function streakDays(signed: PetSnapshot["checkin"]): { day: string; on: boolean }[] {
  const today = new Date();
  const last = signed.last;
  const from = addDays(today, -(signed.streak - 1));
  const out: { day: string; on: boolean }[] = [];
  for (let back = 6; back >= 0; back -= 1) {
    const at = addDays(today, -back);
    const day = localDay(at);
    const on = last !== "" && day <= last && day >= localDay(from) && signed.streak > 0;
    out.push({ day, on });
  }
  return out;
}

/** Today's签到 state, and the streak a签到 today would extend (a gap of a day ends it). */
function checkInState(signed: PetSnapshot["checkin"]): { done: boolean; streak: number } {
  const today = localDay(new Date());
  const yesterday = localDay(addDays(new Date(), -1));
  const live = signed.last === today || signed.last === yesterday ? signed.streak : 0;
  return { done: signed.last === today, streak: live };
}

function CheckInCard({
  pet,
  host,
  busy,
  run,
}: {
  pet: PetSnapshot;
  host: PetPanelHost;
  busy: string | null;
  run: (key: string, act: () => Promise<void>) => void;
}) {
  const rules = host.rules;
  const { done, streak } = checkInState(pet.checkin);
  const next = streak + 1;
  const bonusToday = !done && next % rules.streakEvery === 0;
  return (
    <Card padding="md">
      <CardHeader
        title="每日签到"
        description="每天来看她一眼，口粮和币都记在这天"
        actions={
          <Pill tone={done ? "success" : "attention"}>{done ? "今天已签到" : "今天还没签到"}</Pill>
        }
      />
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-semibold tabular-nums">{streak}</span>
            <span className="text-xs text-fg-muted">天连续</span>
          </div>
          <p className="mt-1 text-xs text-fg-subtle">
            {done
              ? `明天再来；连续第 ${next} 天再多 ${rules.streakBonus} 枚币。`
              : `签到得 ${rules.checkinFood} 份食物、${rules.checkinCoins} 枚币${
                  bonusToday
                    ? `，今天正好连续第 ${next} 天，再多 ${rules.streakBonus} 枚`
                    : `；每连续 ${rules.streakEvery} 天再多 ${rules.streakBonus} 枚`
                }。`}
          </p>
        </div>
        <Button
          variant="primary"
          size="md"
          disabled={done}
          loading={busy === "checkin"}
          onClick={() => run("checkin", () => host.checkin())}
        >
          {done ? "已签到" : "签到"}
        </Button>
      </div>
      <div className="mt-3 flex items-center gap-1.5">
        {streakDays(pet.checkin).map(({ day, on }) => (
          <span
            key={day}
            title={`${day} ${on ? "已签到" : "没有签到"}`}
            className="size-2 rounded-[2px]"
            style={{ background: on ? "var(--ui-accent)" : "var(--ui-inset)" }}
          />
        ))}
        <span className="ml-1 text-xs text-fg-subtle">最近七天</span>
      </div>
    </Card>
  );
}

/** The contribution graph: one column per week (Monday first), one cell per day. */
function UsageGraph({ days }: { days: DayUsage[] }) {
  const busiest = days.reduce((max, day) => Math.max(max, day.tokens), 0);
  const weeks: DayUsage[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return (
    <div>
      <div className="flex gap-[3px]" role="img" aria-label={`最近 ${WEEKS} 周的每日 Token 用量`}>
        {weeks.map((week) => (
          <div key={week[0]?.day ?? ""} className="flex flex-col gap-[3px]">
            {week.map((day) => (
              <span
                key={day.day}
                title={`${day.day} · ${formatTokens(day.tokens)} tokens`}
                className="size-[11px] rounded-[2px]"
                style={{ background: CELL_FILL[heatLevel(day.tokens, busiest)] }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1 text-xs text-fg-subtle">
        <span>少</span>
        {CELL_FILL.map((fill) => (
          <span key={fill} className="size-2 rounded-[2px]" style={{ background: fill }} />
        ))}
        <span>多</span>
      </div>
    </div>
  );
}

function UsageCard({ host }: { host: PetPanelHost }) {
  const [days, setDays] = useState<DayUsage[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    readDailyUsage(WEEKS)
      .then((next) => {
        if (live) setDays(next);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);
  const recent = days?.slice(-7).reduce((sum, day) => sum + day.tokens, 0) ?? 0;
  return (
    <Card padding="md">
      <CardHeader
        title="每日 Token 用量"
        description={`最近 ${WEEKS} 周 · 每 ${formatTokens(host.rules.tokensPerCoin)} tokens 攒 1 枚币`}
        actions={<span className="text-xs text-fg-muted">近 7 天 {formatTokens(recent)}</span>}
      />
      {days === null ? (
        <p className="text-xs text-fg-subtle">{failed ? "用量读不到（服务没应）" : "读取中…"}</p>
      ) : (
        <UsageGraph days={days} />
      )}
    </Card>
  );
}

function StatusCard({ pet, host }: { pet: PetSnapshot; host: PetPanelHost }) {
  const fullness = Math.round(pet.fullness);
  const portions = Math.floor(pet.food);
  return (
    <Card padding="md">
      <CardHeader title="她的状态" description={`已用 ${(pet.mined / 1_000_000).toFixed(1)}M tokens`} />
      <div className="flex items-center justify-between text-xs">
        <span className="text-fg-muted">饱食度</span>
        <span className="tabular-nums text-fg">{fullness} / 100</span>
      </div>
      <ProgressBar
        className="mt-1"
        value={fullness}
        max={100}
        size="sm"
        tone={fullness < 25 ? "danger" : fullness < 55 ? "attention" : "success"}
        label="饱食度"
      />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <StatTile label="食物" value={portions} detail="份" />
        <StatTile label="币" value={pet.coins.toFixed(1)} detail="1M tokens = 1 枚" />
      </div>
      <p className="mt-2 text-xs text-fg-subtle">双击她投喂一份，饱食度 +{host.rules.feed}。</p>
    </Card>
  );
}

function ShopCard({
  pet,
  host,
  busy,
  run,
}: {
  pet: PetSnapshot;
  host: PetPanelHost;
  busy: string | null;
  run: (key: string, act: () => Promise<void>) => void;
}) {
  const { portionsPerCoin, buyAmounts } = host.rules;
  return (
    <Card padding="md">
      <CardHeader
        title="宠物商店"
        description={`每 ${portionsPerCoin} 份口粮卖 1 枚币`}
        actions={<Pill tone="neutral">{pet.coins.toFixed(1)} 枚可用</Pill>}
      />
      <div className="flex flex-col gap-2">
        {buyAmounts.map((amount) => (
          <div key={amount} className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-medium text-fg">{amount * portionsPerCoin} 份食物</div>
              <div className="text-xs text-fg-subtle">{amount} 枚币</div>
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={pet.coins < amount}
              loading={busy === `buy:${amount}`}
              onClick={() => run(`buy:${amount}`, () => host.buy(amount))}
            >
              买
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

function HabitCard({
  pet,
  host,
  quiet,
}: {
  pet: PetSnapshot;
  host: PetPanelHost;
  quiet: (act: () => Promise<unknown>) => void;
}) {
  return (
    <Card padding="md">
      <CardHeader title="她的小习惯" description="存进同一份宠物状态，别处也认" />
      <div className="flex flex-col gap-2">
        <span className="text-xs text-fg-muted">发言</span>
        <Segmented<PetSnapshot["talk"]>
          options={TALK_OPTIONS as ReadonlyArray<ChoiceOption<PetSnapshot["talk"]>>}
          value={pet.talk}
          cols={4}
          onChange={(key) => quiet(() => host.setTalk(key))}
        />
        <span className="text-xs text-fg-muted">活动范围</span>
        <Segmented<PetSnapshot["area"]>
          options={AREA_OPTIONS as ReadonlyArray<ChoiceOption<PetSnapshot["area"]>>}
          value={pet.area}
          cols={4}
          onChange={(key) => quiet(() => host.setArea(key))}
        />
      </div>
    </Card>
  );
}

/** The dialog itself: mounted only while it is open, so every open starts from a clean slate. */
function PetDialog({
  pet,
  host,
  onClose,
}: {
  pet: PetSnapshot;
  host: PetPanelHost;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  // A write the server refuses is not worth a dialog of its own: the pet's state is read back on
  // the next tick anyway, and the button simply re-enables.
  const quiet = useCallback((act: () => Promise<unknown>) => {
    void act().catch(() => {});
  }, []);
  const run = useCallback(
    (key: string, act: () => Promise<unknown>) => {
      setBusy(key);
      void act()
        .catch(() => {})
        .finally(() => setBusy(null));
    },
    [],
  );
  return (
    <Modal
      open
      title={pet.name === "" ? "宠物" : `宠物 · ${pet.name}`}
      onClose={onClose}
      closeLabel="关闭"
      widthClass="sm:max-w-4xl"
    >
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <CheckInCard pet={pet} host={host} busy={busy} run={run} />
          <UsageCard host={host} />
        </div>
        <div className="flex w-full flex-col gap-4 sm:w-72 sm:shrink-0">
          <StatusCard pet={pet} host={host} />
          <ShopCard pet={pet} host={host} busy={busy} run={run} />
          <HabitCard pet={pet} host={host} quiet={quiet} />
        </div>
      </div>
    </Modal>
  );
}

/**
 * Mounts the dialog into `element` and hands widget.js the handle it drives. The open flag and
 * the snapshot live outside React: the host may `open()` on the very turn this module finished
 * loading, before React's first commit, and a queued render would drop it.
 */
export function mountPetPanel(element: HTMLElement, host: PetPanelHost): PetPanel {
  applyStoredTheme();
  const root = createRoot(element);
  let view: { open: boolean; pet: PetSnapshot | null } = { open: false, pet: null };
  const draw = (): void => {
    root.render(
      view.open && view.pet !== null ? (
        <PetDialog
          pet={view.pet}
          host={host}
          onClose={() => {
            view = { open: false, pet: view.pet };
            draw();
            host.close();
          }}
        />
      ) : null,
    );
  };
  const panel: PetPanel = {
    open(pet) {
      view = { open: true, pet };
      draw();
    },
    update(pet) {
      if (!view.open) return;
      view = { ...view, pet };
      draw();
    },
    close() {
      if (!view.open) return;
      view = { open: false, pet: view.pet };
      draw();
    },
  };
  draw();
  return panel;
}
