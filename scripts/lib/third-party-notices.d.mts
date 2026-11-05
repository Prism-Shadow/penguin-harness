/** Types for third-party-notices.mjs, which the server's typechecked tests import. */
export interface VendoredPackage {
  name: string;
  version: string;
  license?: string;
  author?: string;
  repository?: string | { type?: string; url?: string; directory?: string };
  homepage?: string;
  optionalDependencies?: Record<string, string>;
  licenseFile?: string;
  licenseText?: string;
}
export declare function readVendoredPackages(
  dir: string,
  into?: VendoredPackage[],
): VendoredPackage[];
export declare function thirdPartyNotices(
  packages: VendoredPackage[],
  where: { carrier: string; location: string },
): string;
