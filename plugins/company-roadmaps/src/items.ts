/**
 * A roadmap draft's items, checked: the shape `roadmap.draft` takes for each element of its
 * `items` (and `roadmap.item.add` for its one item), the cites against the body's headings, and
 * the proposal item each one is stacked on. Pure: the organization's employees are handed in.
 */
import type { OrgView } from "@prismshadow/penguin-server/plugin";
import { RoadmapError, type DraftItem } from "./domain.js";

const badRequest = (message: string): RoadmapError => new RoadmapError(400, "bad_request", message);

export const ITEM_KEY = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const MAX_ITEMS = 50;

export function isProposalNumber(raw: unknown): raw is number {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 1;
}

/** The headings of a Markdown body, normalized the way a cite is compared. */
export function headingsOf(body: string): Set<string> {
  const out = new Set<string>();
  for (const line of body.split("\n")) {
    const m = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) out.add(normalizeCite(m[1]!));
  }
  return out;
}

export function normalizeCite(cite: string): string {
  return cite.trim().replace(/\s+/g, " ").toLowerCase();
}

export function stringList(raw: unknown, what: string): string[] {
  if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string" || x.trim() === "")) {
    throw badRequest(`${what} must be a list of non-empty strings.`);
  }
  return (raw as string[]).map((x) => x.trim());
}

export function text(raw: unknown, what: string, max: number): string {
  if (typeof raw !== "string" || raw.trim() === "")
    throw badRequest(`${what} must be a non-empty string.`);
  if (raw.length > max) throw badRequest(`${what} is too long (max ${max} characters).`);
  return raw.trim();
}

/** What an item is checked against: the employees, and the items before it in the draft. */
interface ItemContext {
  employees: ReadonlySet<string>;
  /** Each earlier item's kind, by key. */
  seen: Map<string, DraftItem["kind"]>;
  /** The proposals earlier items adopted. */
  adopted: Set<number>;
}

function contextOf(org: Pick<OrgView, "employees">, before: readonly DraftItem[]): ItemContext {
  return {
    employees: new Set(org.employees.map((e) => e.agentId)),
    seen: new Map(before.map((x) => [x.key, x.kind])),
    adopted: new Set(
      before.flatMap((x) =>
        x.kind === "proposal" && x.proposal !== undefined ? [x.proposal] : [],
      ),
    ),
  };
}

/** One item, checked as `at` (`items[2]`, `item`) after the items `ctx` holds; then counted among them. */
function parseOne(entry: unknown, at: string, ctx: ItemContext): DraftItem {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    throw badRequest(`${at} must be an object.`);
  }
  const o = entry as Record<string, unknown>;
  const key = o.key;
  if (typeof key !== "string" || !ITEM_KEY.test(key)) {
    throw badRequest(`${at}.key must be 1–40 lowercase letters, digits or dashes.`);
  }
  if (ctx.seen.has(key)) throw badRequest(`${at}.key repeats "${key}".`);
  const title = text(o.title, `${at}.title`, 200);
  const brief = text(o.brief, `${at}.brief`, 4000);
  // An adopted proposal (`proposal`) may predate the body, so it needs no cite.
  const cites =
    o.cites === undefined && o.proposal !== undefined ? [] : stringList(o.cites, `${at}.cites`);
  if (cites.length === 0 && o.proposal === undefined)
    throw badRequest(`${at}.cites must name at least one body section.`);
  let item: DraftItem;
  if (o.kind === "proposal") {
    const owner = typeof o.owner === "string" ? o.owner : "";
    if (!ctx.employees.has(owner)) throw badRequest(`${at}.owner is not an employee: ${owner}`);
    const p: DraftItem = { key, kind: "proposal", title, brief, owner, cites };
    if (o.proposal !== undefined) {
      if (!isProposalNumber(o.proposal))
        throw badRequest(`${at}.proposal must be a proposal number.`);
      if (ctx.adopted.has(o.proposal))
        throw badRequest(`${at}.proposal repeats proposal #${o.proposal}.`);
      p.proposal = o.proposal;
      ctx.adopted.add(o.proposal);
    }
    if (o.stackedOn === null) p.stackedOn = null;
    else if (o.stackedOn !== undefined) {
      if (typeof o.stackedOn !== "string" || ctx.seen.get(o.stackedOn) !== "proposal") {
        throw badRequest(
          `${at}.stackedOn must name an earlier proposal item: ${String(o.stackedOn)}`,
        );
      }
      p.stackedOn = o.stackedOn;
    }
    item = p;
  } else if (o.kind === "roadmap") {
    const list = stringList(o.employees, `${at}.employees`);
    if (list.length === 0) throw badRequest(`${at}.employees must name at least one employee.`);
    if (new Set(list).size !== list.length)
      throw badRequest(`${at}.employees repeats an employee.`);
    for (const e of list) {
      if (!ctx.employees.has(e)) throw badRequest(`${at}.employees: not an employee: ${e}`);
    }
    item = { key, kind: "roadmap", title, brief, employees: list, cites };
  } else {
    throw badRequest(`${at}.kind must be "proposal" or "roadmap".`);
  }
  ctx.seen.set(key, item.kind);
  return item;
}

/**
 * The draft's items, checked: unique keys, a kind, a title and a brief, at least one cite; a
 * proposal item's owner is an employee and its `stackedOn` an EARLIER proposal item (or null);
 * a roadmap item's employees are employees.
 */
export function parseItems(raw: unknown, org: Pick<OrgView, "employees">): DraftItem[] {
  if (!Array.isArray(raw)) throw badRequest("items must be a list.");
  if (raw.length > MAX_ITEMS) throw badRequest(`At most ${MAX_ITEMS} items.`);
  const ctx = contextOf(org, []);
  return raw.map((entry, i) => parseOne(entry, `items[${i}]`, ctx));
}

/**
 * One item appended to `items` (`roadmap.item.add`), checked as an element of the draft's
 * items would be after them: its `stackedOn` may name any of them. A key one of them has is
 * the caller's to resolve (409 `item_exists`), not a malformed draft.
 */
export function parseAddedItem(
  raw: unknown,
  items: readonly DraftItem[],
  org: Pick<OrgView, "employees">,
): DraftItem {
  const key = (raw as { key?: unknown } | null)?.key;
  if (typeof key === "string" && items.some((x) => x.key === key)) {
    throw new RoadmapError(409, "item_exists", `The draft has an item ${key} already.`);
  }
  if (items.length >= MAX_ITEMS) throw badRequest(`At most ${MAX_ITEMS} items.`);
  return parseOne(raw, "item", contextOf(org, items));
}

/** The cites that name no section of the body, as `key: cite`. */
export function unknownCites(body: string, items: readonly DraftItem[]): string[] {
  const headings = headingsOf(body);
  const out: string[] = [];
  for (const item of items) {
    for (const cite of item.cites) {
      if (!headings.has(normalizeCite(cite))) out.push(`${item.key}: ${cite}`);
    }
  }
  return out;
}

/** The proposal item each proposal item is stacked on: its own `stackedOn`, else the previous proposal item. */
export function basesOf(items: readonly DraftItem[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  let previous: string | null = null;
  for (const item of items) {
    if (item.kind !== "proposal") continue;
    out.set(item.key, item.stackedOn === undefined ? previous : item.stackedOn);
    previous = item.key;
  }
  return out;
}
