/** Types for published.mjs. */

/** A market document as read (market.mjs): package names, and each named plugin's art. */
export interface MarketDocument {
  hero: string[];
  selected: string[];
  plugins: Map<
    string,
    {
      cover?: { src: string; thumb?: string; tone?: string };
      icon?: string;
      screenshots?: { src: string; thumb?: string; caption?: string; captionZh?: string }[];
    }
  >;
  /** Where the counts come from and each package's, when the document carries a popularity block. */
  popularity?: {
    source: "placeholder" | "live";
    items: Map<string, { installs: number; weekly: number }>;
  };
}

/** What the hub reads from the network: the curation document and the index's rows. */
export interface Published {
  market?: MarketDocument;
  index?: readonly object[];
}

export declare const MARKET_DOCUMENT_URL: string;
export declare const PLUGIN_INDEX_URL: string;
export declare const PUBLISHED_DIR: string;

export declare function fetchPublished(options?: {
  refresh?: boolean;
  env?: Record<string, string | undefined>;
  cacheDir?: string;
  fetchImpl?: (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;
}): Promise<void>;

export declare function readPublished(options?: {
  env?: Record<string, string | undefined>;
  cacheDir?: string;
  embeddedMarket?: string;
}): Required<Published>;
