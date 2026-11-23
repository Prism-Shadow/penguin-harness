/** Types of build-a2ui-check.mjs for the A2UI test that checks the released bundle's freshness. */
export declare const SOURCES_DIR: string;
export declare const HASH_MARKER: string;
export declare function hashA2uiSources(dir?: string): string;
export declare function readBundleHash(file: string): string | null;
