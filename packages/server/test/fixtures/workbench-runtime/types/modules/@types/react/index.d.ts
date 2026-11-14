export interface ReactElement {
  type: unknown;
  props: unknown;
  key: string | null;
}

export type ReactNode =
  ReactElement | string | number | boolean | null | undefined | Iterable<ReactNode>;

export declare function useState<S>(initial: S): [S, (next: S) => void];
