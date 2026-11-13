import type { ReactElement, ReactNode } from "./index.js";

export namespace JSX {
  interface Element extends ReactElement {}
  interface ElementChildrenAttribute {
    children: {};
  }
  interface IntrinsicAttributes {
    key?: string | number;
  }
  interface IntrinsicElements {
    [name: string]: { [prop: string]: unknown; children?: ReactNode };
  }
}

export declare function jsx(type: unknown, props: unknown, key?: string): ReactElement;
export declare function jsxs(type: unknown, props: unknown, key?: string): ReactElement;
