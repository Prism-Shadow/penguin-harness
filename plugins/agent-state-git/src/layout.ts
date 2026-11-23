import pins from "dugite/script/embedded-git.json" with { type: "json" };

/** One row of dugite's table. */
export interface GitPin {
  name: string;
  url: string;
  checksum: string;
}

/** Where a Git is: the program, and the directory its own commands (`git unpack-objects`) are found in. */
export interface GitProgram {
  program: string;
  execPath: string;
}

export const TABLE = pins as Record<string, GitPin>;

/** dugite's key for a host: `<platform>-<arch>`, as Node names them. */
export function pinFor(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): GitPin | null {
  return TABLE[`${platform}-${arch}`] ?? null;
}

/** The MSYS2 environment a Windows build lives in, by architecture (dugite's own choice). */
export function windowsSubfolder(arch: string): string {
  return arch === "x64" ? "ucrt64" : arch === "arm64" ? "clangarm64" : "mingw32";
}

/** What is kept of an archive, by path inside it. */
export function keptFiles(platform: NodeJS.Platform, arch: string): string[] {
  if (platform !== "win32") return ["bin/git"];
  const bin = `${windowsSubfolder(arch)}/bin`;
  const dlls = ["libiconv-2.dll", "libintl-8.dll", "libpcre2-8-0.dll", "zlib1.dll"];
  if (arch === "ia32") dlls.push("libgcc_s_dw2-1.dll", "libwinpthread-1.dll");
  return [`${bin}/git.exe`, ...dlls.map((dll) => `${bin}/${dll}`)];
}
