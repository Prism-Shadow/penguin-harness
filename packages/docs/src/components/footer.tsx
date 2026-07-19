/** Slim docs footer: copyright + repo / license / main-site links on one line. */
import { S } from "../lib/strings";
import { LICENSE_URL, REPO_URL, SITE_URL } from "../lib/links";

export function Footer() {
  const link = "transition-colors hover:text-gray-900 dark:hover:text-gray-100 whitespace-nowrap";
  return (
    <footer className="border-t border-gray-200 dark:border-gray-800">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-6 text-xs text-gray-400 sm:px-6 dark:text-gray-500">
        <p>{S.footer.copyright}</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <a href={SITE_URL} className={link}>
            {S.footer.site}
          </a>
          <a href={REPO_URL} target="_blank" rel="noreferrer" className={link}>
            {S.footer.repo}
          </a>
          <a href={LICENSE_URL} target="_blank" rel="noreferrer" className={link}>
            {S.footer.license}
          </a>
        </div>
      </div>
    </footer>
  );
}
