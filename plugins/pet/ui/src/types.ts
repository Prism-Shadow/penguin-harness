/**
 * What the pet's dialog and its host (widget.js) agree on.
 *
 * The host owns the pet's state and every write to it — it is the one that PATCHes the server,
 * ticks hunger and mines coins — and hands the dialog a snapshot to draw plus the actions a
 * click turns into. The dialog reads nothing about the pet itself, so there is one owner of the
 * numbers and no second copy of them to drift.
 *
 * The reward rules travel with the host for the same reason: the copy the dialog prints ("签到得
 * 1 份食物和 2 枚币") is derived from the numbers the host actually spends, never typed twice.
 */

/** How often she speaks on her own. */
export type TalkKey = "off" | "rare" | "normal" | "chatty";

/** How much of the page she may roam. */
export type AreaKey = "page" | "lower" | "dock" | "spot";

/** One option of a segmented choice. */
export interface ChoiceOption<K extends string> {
  value: K;
  label: string;
}

export const TALK_OPTIONS: ReadonlyArray<ChoiceOption<TalkKey>> = [
  { value: "off", label: "静音" },
  { value: "rare", label: "少" },
  { value: "normal", label: "中" },
  { value: "chatty", label: "多" },
];

export const AREA_OPTIONS: ReadonlyArray<ChoiceOption<AreaKey>> = [
  { value: "page", label: "全页" },
  { value: "lower", label: "下半屏" },
  { value: "dock", label: "底部" },
  { value: "spot", label: "原地" },
];

/** What one签到 (or one portion, or one coin) is worth — the host's own numbers. */
export interface PetRules {
  /** Fullness one portion restores when she is fed. */
  feed: number;
  /** Portions one coin buys. */
  portionsPerCoin: number;
  /** Tokens that earn one coin. */
  tokensPerCoin: number;
  /** The coin amounts the shop sells, ascending. */
  buyAmounts: readonly number[];
  /** Food granted by a签到. */
  checkinFood: number;
  /** Coins granted by a签到. */
  checkinCoins: number;
  /** Every this many consecutive days, a签到 pays {@link streakBonus} extra coins. */
  streakEvery: number;
  streakBonus: number;
}

/** One day of签到 history, as the server keeps it. */
export interface CheckIn {
  /** The last day signed, `yyyy-mm-dd` local; empty when she never has been. */
  last: string;
  /** Days signed in a row, ending at {@link last}. */
  streak: number;
}

/** Everything the dialog draws about the pet. */
export interface PetSnapshot {
  name: string;
  /** 0–100. */
  fullness: number;
  /** Portions in the pantry. */
  food: number;
  /** Coins: earned from Token usage, spent on food. */
  coins: number;
  /** Lifetime Tokens already turned into coins. */
  mined: number;
  /** Whether the one-off starter bowl was granted. */
  gift: boolean;
  talk: TalkKey;
  area: AreaKey;
  checkin: CheckIn;
}

/** What the dialog may ask the host to do. Every call resolves once the server has the write. */
export interface PetPanelHost {
  readonly rules: PetRules;
  buy(amount: number): Promise<void>;
  checkin(): Promise<void>;
  setTalk(key: TalkKey): Promise<void>;
  setArea(key: AreaKey): Promise<void>;
  /** The dialog closed itself (its own button, Escape, the scrim): the host gives the pointer back. */
  close(): void;
}

/** The handle widget.js keeps: open the dialog, keep it current, close it. */
export interface PetPanel {
  open(pet: PetSnapshot): void;
  update(pet: PetSnapshot): void;
  close(): void;
}
