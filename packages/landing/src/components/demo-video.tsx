/**
 * A demo recording in a plain frame. Nothing downloads until play (preload="none"); the poster is
 * the recording's own title frame, so one still stands in for it in light and dark mode alike.
 */
export function DemoVideo({ src, poster, label }: { src: string; poster: string; label: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-gray-950 shadow-sm dark:border-gray-800">
      <video
        src={src}
        poster={poster}
        controls
        preload="none"
        playsInline
        aria-label={label}
        className="block aspect-video h-auto w-full"
      />
    </div>
  );
}
