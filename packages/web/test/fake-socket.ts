/** A WebSocket the test drives by hand: it records what was sent and fires what the test wants. */
export class FakeSocket {
  static instances: FakeSocket[] = [];
  /**
   * Marks this as a suite's own scripted socket rather than a browser's: test/socket-stand-in.ts
   * hands the suites that stub it the product's real socket client, and everything else — jsdom
   * included, whose `WebSocket` would try to reach a server no suite is running — its stand-in.
   */
  static readonly scripted = true;
  readonly sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.onclose?.();
  }
  // test controls
  open() {
    this.onopen?.();
  }
  receive(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  drop() {
    this.onclose?.();
  }
  frames(): Record<string, unknown>[] {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}
