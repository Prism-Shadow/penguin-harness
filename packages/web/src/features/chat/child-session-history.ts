import type { ChildSessionEntry } from "../../api/endpoints";

interface ChildPage {
  items: ChildSessionEntry[];
  nextCursor: string | null;
}

/** A contiguous prefix of the parent's newest-first index. Positions are the server's, even at equal timestamps. */
export class ChildSessionHistory {
  items: ChildSessionEntry[] = [];
  nextCursor: string | null = null;

  constructor(private readonly read: (before?: string) => Promise<ChildPage>) {}

  async refresh(): Promise<void> {
    const boundary = this.items[0]?.sessionId;
    const head: ChildSessionEntry[] = [];
    let before: string | undefined;
    for (;;) {
      const page = await this.read(before);
      head.push(...page.items);
      if (boundary && page.items.some((child) => child.sessionId === boundary)) {
        const seen = new Set(head.map((child) => child.sessionId));
        this.items = [...head, ...this.items.filter((child) => !seen.has(child.sessionId))];
        return;
      }
      if (!boundary || !page.nextCursor) {
        this.items = head;
        this.nextCursor = page.nextCursor;
        return;
      }
      before = page.nextCursor;
    }
  }

  async completeTurn(anchor: string | null): Promise<void> {
    // The final turn in a transport page can continue on the next page.
    while (this.nextCursor) {
      const turn = anchor
        ? this.items.find((child) => child.sessionId === anchor)?.turnKey
        : this.items[0]?.turnKey;
      if (turn && this.items.at(-1)?.turnKey !== turn) return;
      const page = await this.read(this.nextCursor);
      this.items = [...this.items, ...page.items];
      this.nextCursor = page.nextCursor;
    }
  }
}
