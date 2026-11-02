/**
 * A plugin's own icon.svg, drawn as a mask so it takes the text colour in both themes (the
 * icons stroke `currentColor`, which an <img> would render black).
 */
export function HubIcon({ src, size = "md" }: { src?: string; size?: "md" | "lg" }) {
  const box = size === "lg" ? "h-8 w-8" : "h-5 w-5";
  if (!src) return <span aria-hidden className={`${box} shrink-0`} />;
  return (
    <span
      aria-hidden
      className={`${box} mt-0.5 shrink-0 bg-gray-700 dark:bg-gray-300`}
      style={{
        maskImage: `url("${src}")`,
        WebkitMaskImage: `url("${src}")`,
        maskSize: "contain",
        WebkitMaskSize: "contain",
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
      }}
    />
  );
}
