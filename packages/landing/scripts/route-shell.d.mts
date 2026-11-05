/** Types for route-shell.mjs, which the landing's typechecked tests import. */
export interface RouteMeta {
  title: string;
  description: string;
  /** The share card's absolute URL. */
  image: string;
  imageAlt: string;
}

export declare function shellFor(shell: string, url: string, meta?: RouteMeta): string;
export declare function notFoundShell(shell: string): string;
