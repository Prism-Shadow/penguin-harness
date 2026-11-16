import type { ReactNode } from "react";

export interface Root {
  render(children: ReactNode): void;
  unmount(): void;
}

export declare function createRoot(container: Element | DocumentFragment): Root;
