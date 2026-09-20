/**
 * The chrome's own glyphs: a 16px line icon at a fixed 1.5 stroke. They deliberately ignore
 * `--ui-icon-stroke` — the chrome must look the same whatever theme is under test.
 */
const PATHS = {
  link: "M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1",
  code: "m8 7-5 5 5 5M16 7l5 5-5 5",
  tokens:
    "M12 3a9 9 0 1 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.4A4.6 4.6 0 0 0 22 9.8C22 5.9 17.5 3 12 3zM7.5 11.5h.01M10.5 7.5h.01M15.5 7.5h.01",
  check: "M5 13l4 4L19 7",
  copy: "M9 9h9v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V9zM7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  monitor: "M3 4h18v12H3zM8 20h8M12 16v4",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  back: "M15 18 9 12l6-6",
  type: "M4 7V4h16v3M9 20h6M12 4v16",
  parts: "m12 3 9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5",
} as const;

export type ChromeIconName = keyof typeof PATHS;

export function ChromeIcon({ name, size = 16 }: { name: ChromeIconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="g-icon"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
