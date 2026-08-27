import packageInfo from "../../package.json";

/** Release version shown beside installer actions; kept in sync by the normal version bump. */
export const RELEASE_VERSION = `v${packageInfo.version}`;
