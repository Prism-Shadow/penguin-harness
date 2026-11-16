/** A plain window bar over product screenshots and live frames: the address, then an aside. */
import type { ReactNode } from "react";

export function BrowserFrame({
  children,
  url = "127.0.0.1:7364",
  aside,
  className = "",
}: {
  children: ReactNode;
  url?: string;
  /** What sits right of the address (a link out). */
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900 ${className}`}
    >
      <div className="flex items-center gap-3 border-b border-gray-200 px-3.5 py-2.5 dark:border-gray-800">
        <span className="min-w-0 flex-1 truncate rounded-md bg-gray-100 px-3 py-1 text-center font-mono text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
          {url}
        </span>
        {aside}
      </div>
      {children}
    </div>
  );
}
