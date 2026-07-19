/**
 * Ambient neon backdrop: faint blurred glows drifting slowly behind the whole page,
 * anchored to the document (the layout root is position:relative) so they scroll away
 * with the content. Styles in styles.css; reduced-motion freezes them. Decorative only.
 */
export function NeonBackground() {
  return (
    <div className="neon-bg" aria-hidden="true">
      <span className="neon-blob neon-blob-a" />
      <span className="neon-blob neon-blob-b" />
      <span className="neon-blob neon-blob-c" />
      <span className="neon-blob neon-blob-d" />
    </div>
  );
}
