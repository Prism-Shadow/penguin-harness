/**
 * What a post's route shows while its code or its body is on the way: nothing, a screen tall, so
 * the footer stays below the fold instead of showing under an empty page and jumping away when
 * the post lands.
 */
export function PostPending() {
  return <div className="min-h-screen" />;
}
