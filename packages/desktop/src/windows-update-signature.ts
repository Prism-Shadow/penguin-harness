/**
 * Windows updates trust Authenticode and the feed's SHA-512, not a signing-service
 * certificate's name. Feed/account security is therefore part of the trust boundary.
 */
import childProcess from "node:child_process";
import path from "node:path";

export type SignatureExecFile = (
  file: string,
  args: string[],
  options: {
    env: NodeJS.ProcessEnv;
    encoding: "utf8";
    windowsHide: boolean;
    timeout: number;
    maxBuffer: number;
  },
  callback: (error: Error | null, stdout: string, stderr: string) => void,
) => void;

const runSignatureCheck: SignatureExecFile = (file, args, options, callback) => {
  childProcess.execFile(file, args, options, callback);
};

const SIGNATURE_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$signature = Get-AuthenticodeSignature -LiteralPath $env:PENGUIN_UPDATE_VERIFY_PATH
[pscustomobject]@{
  Status = [int]$signature.Status
  HasSigner = ($null -ne $signature.SignerCertificate)
  Path = $signature.Path
} | ConvertTo-Json -Compress
`;

/** Returns null only after Windows verifies the requested file's signature. */
export async function verifyWindowsUpdateSignature(
  file: string,
  run: SignatureExecFile = runSignatureCheck,
): Promise<string | null> {
  const failure = "Windows update signature could not be verified.";
  if (!path.win32.isAbsolute(file) || file.includes("\0")) return failure;
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  if (!path.win32.isAbsolute(systemRoot)) return failure;
  try {
    const env = { ...process.env };
    // Worker environments can preserve a differently cased key. Windows chooses
    // only one of duplicate environment names, so remove every spelling first.
    for (const key of Object.keys(env)) {
      if (key.toLowerCase() === "psmodulepath") delete env[key];
    }
    env.PSModulePath = "";
    env.PENGUIN_UPDATE_VERIFY_PATH = file;
    const stdout = await new Promise<string>((resolve, reject) => {
      run(
        path.win32.join(systemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe"),
        [
          "-NoProfile",
          "-NonInteractive",
          "-InputFormat",
          "None",
          "-EncodedCommand",
          Buffer.from(SIGNATURE_SCRIPT, "utf16le").toString("base64"),
        ],
        {
          env,
          encoding: "utf8",
          windowsHide: true,
          timeout: 20_000,
          maxBuffer: 64 * 1024,
        },
        (error, output, stderr) => {
          if (error || stderr.trim()) reject(new Error(failure));
          else resolve(output);
        },
      );
    });
    const result: unknown = JSON.parse(stdout.replace(/^\uFEFF/, ""));
    if (typeof result !== "object" || result === null || Array.isArray(result)) return failure;
    const info = result as Record<string, unknown>;
    if (
      info.Status !== 0 ||
      info.HasSigner !== true ||
      typeof info.Path !== "string" ||
      path.win32.normalize(info.Path).toLowerCase() !== path.win32.normalize(file).toLowerCase()
    ) {
      return failure;
    }
    return null;
  } catch {
    return failure;
  }
}
