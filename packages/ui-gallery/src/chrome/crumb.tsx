/**
 * The quotable breadcrumb: the address of what a preview shows (lib/breadcrumb.ts), copied to the
 * clipboard with a click, so feedback can name a view exactly. Copied, only the icon changes to a
 * check for a moment; the address stays readable.
 */
import { useGallery } from "../state";
import { useCopy } from "./copy";
import { ChromeIcon } from "./icons";

export function Breadcrumb({ text, className = "" }: { text: string; className?: string }) {
  const { S } = useGallery();
  const [copied, copy] = useCopy();
  return (
    <button
      type="button"
      className={`g-crumb ${className}`}
      aria-label={S.section.copyBreadcrumb}
      data-tooltip={S.section.copyBreadcrumb}
      onClick={() => copy("crumb", text)}
    >
      <ChromeIcon name={copied ? "check" : "copy"} size={13} />
      <span>{text}</span>
    </button>
  );
}
