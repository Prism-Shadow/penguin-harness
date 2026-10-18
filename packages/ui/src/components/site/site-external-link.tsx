/**
 * Links that leave the site ask first. `SiteExternalLink` renders a real `<a target="_blank">`, so
 * the address still shows on hover and the context menu still offers it, but a click, a modifier
 * click or a middle click opens a confirmation instead; only the dialog's own link opens the page.
 *
 * `SiteExternalLinkScope` owns that confirmation: one native modal `<dialog>` per scope, so the
 * browser supplies the focus trap, Esc and the top layer. Focus starts on Cancel; Esc, Cancel, a
 * click on the backdrop and the dialog's open link all close it, and however it closes, focus
 * returns to the link that asked. Outside a scope a `SiteExternalLink` is an ordinary link.
 */
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { MouseEvent, ReactNode } from "react";
import { ExternalLinkIcon } from "./site-icons";

type Confirm = (href: string, trigger: HTMLElement) => void;

const ConfirmContext = createContext<Confirm | null>(null);

export interface SiteExternalLinkLabels {
  title: string;
  /** The sentence above the address. */
  body: string;
  cancel: string;
  open: string;
}

export function SiteExternalLinkScope({
  labels,
  children,
}: {
  labels: SiteExternalLinkLabels;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  /** Whether the press that ends in a click began on the backdrop too (not a drag out of the box). */
  const pressedBackdropRef = useRef(false);
  const [href, setHref] = useState<string | null>(null);
  const titleId = useId();
  const bodyId = useId();

  // Opened after React has written the new address into the dialog, so it is in place before the
  // dialog is shown and announced.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (href === null || !dialog || dialog.open) return;
    dialog.showModal();
    cancelRef.current?.focus();
  }, [href]);

  const confirm = useCallback<Confirm>((next, trigger) => {
    triggerRef.current = trigger;
    setHref(next);
  }, []);
  const close = () => dialogRef.current?.close();

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="site-leave m-auto w-[calc(100%-2rem)] max-w-sm text-left"
        onClose={() => {
          setHref(null);
          triggerRef.current?.focus({ preventScroll: true });
        }}
        onPointerDown={(event) => {
          pressedBackdropRef.current = event.target === event.currentTarget;
        }}
        onClick={(event) => {
          // The padded content covers the whole box, so a click on the dialog element itself
          // landed on the backdrop.
          if (event.target === event.currentTarget && pressedBackdropRef.current) close();
        }}
      >
        <div className="site-leave-body">
          <h2 id={titleId} className="text-base font-semibold tracking-tight">
            {labels.title}
          </h2>
          <div id={bodyId} className="site-leave-text mt-2 text-sm leading-6">
            <p>{labels.body}</p>
            <p className="site-leave-href mt-1.5 font-mono text-xs leading-5 break-all">{href}</p>
          </div>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button
              ref={cancelRef}
              type="button"
              onClick={close}
              className="site-leave-cancel inline-flex h-9 items-center justify-center px-4 text-sm font-medium"
            >
              {labels.cancel}
            </button>
            <a
              href={href ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              onClick={close}
              className="site-leave-open inline-flex h-9 items-center justify-center gap-1.5 px-4 text-sm font-semibold"
            >
              {labels.open}
              <ExternalLinkIcon className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </dialog>
    </ConfirmContext.Provider>
  );
}

export function SiteExternalLink({
  href,
  className,
  title,
  "aria-label": ariaLabel,
  children,
}: {
  href: string;
  className?: string;
  title?: string;
  "aria-label"?: string;
  children: ReactNode;
}) {
  const confirm = useContext(ConfirmContext);
  const ask = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!confirm) return;
    event.preventDefault();
    confirm(href, event.currentTarget);
  };
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      title={title}
      aria-label={ariaLabel}
      onClick={ask}
      onAuxClick={(event) => {
        if (event.button === 1) ask(event);
      }}
    >
      {children}
    </a>
  );
}
