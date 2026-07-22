/**
 * Demo video embed. The file itself is hosted in the sibling community repo (see
 * `demoVideoUrl` in lib/links.ts for why), so the important part here is that nothing
 * is fetched until the visitor asks: `preload="none"` plus a poster means a page view
 * costs one ~37 KB still, not a ~9 MB download, and the section still looks finished
 * before anyone presses play.
 *
 * Deliberately NOT wrapped in BrowserFrame: that chrome (with its localhost address bar)
 * says "this is the product's UI", which is true of a screenshot and of the case demos,
 * but not of a narrated slide deck. A plain framed surface instead.
 */

export function DemoVideo({
  src,
  poster,
  label,
  caption,
}: {
  src: string;
  poster: string;
  /** Accessible name — the surrounding copy is decorative to a screen reader. */
  label: string;
  caption?: string;
}) {
  return (
    <figure className="mx-auto w-full max-w-4xl">
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-gray-950 shadow-sm dark:border-gray-800">
        <video
          src={src}
          poster={poster}
          controls
          preload="none"
          playsInline
          aria-label={label}
          className="block h-auto w-full"
        />
      </div>
      {caption && (
        <figcaption className="mt-3 text-center text-xs text-gray-500 dark:text-gray-400">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
