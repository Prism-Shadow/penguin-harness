/** Fake browser chrome around product screenshots: traffic dots + address pill. */
import type { ReactNode } from "react";

export function BrowserFrame({
  children,
  url = "127.0.0.1:7364",
  className = "",
}: {
  children: ReactNode;
  url?: string;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900 ${className}`}
    >
      <div className="flex items-center gap-3 border-b border-gray-200 px-3.5 py-2.5 dark:border-gray-800">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-gray-300 dark:bg-gray-700" />
          <span className="h-2.5 w-2.5 rounded-full bg-gray-300 dark:bg-gray-700" />
          <span className="h-2.5 w-2.5 rounded-full bg-gray-300 dark:bg-gray-700" />
        </span>
        <span className="min-w-0 flex-1 truncate rounded-md bg-gray-100 px-3 py-1 text-center font-mono text-[11px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">
          {url}
        </span>
        <span className="w-10" aria-hidden="true" />
      </div>
      {children}
    </div>
  );
}
