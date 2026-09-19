/**
 * Static stand-ins the gallery modules compose, beside the screens' own (`screens/parts.tsx`). Each
 * is named after the component it imitates (A-architecture §3, K-redesign §5.1) and takes that
 * component's props, so a wave swaps it for the real thing by changing an import. Token utilities
 * and the declared style hooks only; no state.
 *
 * The names are load-bearing beyond readability: a style hook is allowed only inside the component
 * that hosts it (`FloatingPanel`, `Modal` and `Tooltip` wear `.ui-glass`, `GroupHeader`, `MenuLabel`
 * and `Text` the eyebrow, `Heading` the display face, `Dot` the live pulse, `Tabs` the underline),
 * and the package's de-slop guard reads the enclosing function's name to check it.
 */
import type { AccentSwatchFixture } from "../fixtures";
import type { ToneName } from "../tokens";
import type { ReactNode } from "react";
import { GLYPHS } from "../screens/glyph";
import { Spinner } from "../components/icons/spinner/spinner";

// ---------------------------------------------------------------------------------------------
// Icons (W1: GlyphIcon, ICONS)
// ---------------------------------------------------------------------------------------------

/** The screens' glyphs plus the few more the modules draw, in the same lucide spelling. */
export const ICON_PATHS = {
  ...GLYPHS,
  external: "M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
  refresh: "M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5",
  more: "M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  pencil: "M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z",
  trash: "M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
  check: "M20 6 9 17l-5-5",
  key: "M2.59 17.41A2 2 0 0 0 2 18.83V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.17a2 2 0 0 0 1.42-.59l.81-.81a6.5 6.5 0 1 0-4-4ZM16.5 7.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1Z",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 16v-4M12 8h.01",
  alert:
    "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3ZM12 9v4M12 17h.01",
  arrowUp: "m5 12 7-7 7 7M12 19V5",
  arrowDown: "M12 5v14M19 12l-7 7-7-7",
  sort: "m21 16-4 4-4-4M17 20V4M3 8l4-4 4 4M7 4v16",
  image:
    "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM9 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM21 15l-3.1-3.1a2 2 0 0 0-2.8 0L6 21",
  lock: "M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2ZM7 11V7a5 5 0 0 1 10 0v4",
  link: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
  filter: "M22 3H2l8 9.46V19l4 2v-8.54Z",
  bell: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0",
  command: "M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3",
  calendar:
    "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z",
  kanban: "M6 5v11M12 5v6M18 5v14",
  network: "M9 2h6v6H9zM3 16h6v6H3zM15 16h6v6h-6zM6 16v-3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v3M12 12V8",
  hash: "M4 9h16M4 15h16M10 3 8 21M16 3l-2 18",
  minus: "M5 12h14",
  eyeOff:
    "M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61M2 2l20 20M14.12 14.12a3 3 0 1 1-4.24-4.24",
  grip: "M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01",
  paperclip:
    "m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48",
  stop: "M7 7h10v10H7z",
  chevronLeft: "m15 18-6-6 6-6",
} as const;

export type IconName = keyof typeof ICON_PATHS;

/** A line icon at the theme's stroke, cap and join; pixel sizes, like the app's `ICON_SIZE`. */
export function GlyphIcon({
  name,
  size = 14,
  className = "",
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      aria-hidden
      className={`block shrink-0 ${className}`}
      style={{
        strokeWidth: "var(--ui-icon-stroke)",
        strokeLinecap: "var(--ui-icon-cap)" as "round",
        strokeLinejoin: "var(--ui-icon-join)" as "round",
      }}
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------
// Tone maps: full class strings, so Tailwind sees every one
// ---------------------------------------------------------------------------------------------

export const TONE_INK: Record<ToneName, string> = {
  success: "text-tone-success-fg",
  attention: "text-tone-attention-fg",
  danger: "text-tone-danger-fg",
  done: "text-tone-done-fg",
  neutral: "text-tone-neutral-fg",
  info: "text-tone-info-fg",
};

const TONE_DOT: Record<ToneName, string> = {
  success: "bg-tone-success-fg",
  attention: "bg-tone-attention-fg",
  danger: "bg-tone-danger-fg",
  done: "bg-tone-done-fg",
  neutral: "bg-tone-neutral-fg",
  info: "bg-tone-info-fg",
};

const TONE_TINT: Record<ToneName, string> = {
  success: "bg-tone-success-bg",
  attention: "bg-tone-attention-bg",
  danger: "bg-tone-danger-bg",
  done: "bg-tone-done-bg",
  neutral: "bg-tone-neutral-bg",
  info: "bg-tone-info-bg",
};

const TONE_LINE: Record<ToneName, string> = {
  success: "border-tone-success-line",
  attention: "border-tone-attention-line",
  danger: "border-tone-danger-line",
  done: "border-tone-done-line",
  neutral: "border-tone-neutral-line",
  info: "border-tone-info-line",
};

const TONE_SOLID: Record<ToneName, string> = {
  success: "bg-tone-success-emphasis text-tone-success-emphasis-fg",
  attention: "bg-tone-attention-emphasis text-tone-attention-emphasis-fg",
  danger: "bg-tone-danger-emphasis text-tone-danger-emphasis-fg",
  done: "bg-tone-done-emphasis text-tone-done-emphasis-fg",
  neutral: "bg-tone-neutral-emphasis text-tone-neutral-emphasis-fg",
  info: "bg-tone-info-emphasis text-tone-info-emphasis-fg",
};

/** The glyph a tone's notice leads with. */
export const TONE_GLYPH: Record<ToneName, IconName> = {
  success: "circleCheck",
  attention: "alert",
  danger: "circleCross",
  done: "circleCheck",
  neutral: "info",
  info: "info",
};

// ---------------------------------------------------------------------------------------------
// Marks (W1: Dot, Spinner)
// ---------------------------------------------------------------------------------------------

const DOT_SIZE = { xs: "size-1.5", sm: "size-2", md: "size-2.5" } as const;

/** A flat state dot in tone ink; `live` pulses it while the thing it marks is running. */
export function Dot({
  tone,
  size = "sm",
  live = false,
  label,
}: {
  tone: ToneName;
  size?: keyof typeof DOT_SIZE;
  live?: boolean;
  label?: string;
}) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-live={live ? "dot" : undefined}
      className={`${live ? "ui-live animate-pulse " : ""}inline-block ${DOT_SIZE[size]} shrink-0 rounded-full ${TONE_DOT[tone]}`}
    />
  );
}

/**
 * The package's one Spinner in a tone's ink: every module spinner goes through here. `label`
 * announces what runs; without one the spinner sits beside the word that says so, and assistive
 * tech hears the word once rather than twice.
 */
export function RunSpinner({
  tone = "success",
  label,
}: {
  tone?: ToneName | "inherit";
  label?: string;
}) {
  return label === undefined ? (
    <span aria-hidden className="inline-flex shrink-0">
      <Spinner size="sm" tone={tone} label="" />
    </span>
  ) : (
    <Spinner size="sm" tone={tone} label={label} />
  );
}

// ---------------------------------------------------------------------------------------------
// Actions (W1: Button, IconButton, Link, Kbd)
// ---------------------------------------------------------------------------------------------

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "link";
export type ButtonState = "rest" | "hover" | "focus" | "disabled" | "loading";

const BUTTON_SIZE = {
  xs: "h-6 gap-1 px-2 text-xs",
  sm: "h-7 gap-1.5 px-2.5 text-xs",
  md: "h-8 gap-1.5 px-3 text-sm",
  lg: "h-10 gap-2 px-4 text-sm",
} as const;

const BUTTON_REST: Record<ButtonVariant, string> = {
  primary: "border border-accent bg-accent text-accent-fg",
  secondary: "border border-line-emphasis bg-surface text-fg",
  danger: "border border-tone-danger-emphasis bg-tone-danger-emphasis text-tone-danger-emphasis-fg",
  ghost: "border border-transparent text-fg-muted",
  link: "border border-transparent text-link underline decoration-current/40 underline-offset-2",
};

const BUTTON_HOVER: Record<ButtonVariant, string> = {
  primary: "border border-accent-hover bg-accent-hover text-accent-fg",
  secondary: "border border-line-emphasis bg-surface-muted text-fg",
  danger: "border border-tone-danger-fg bg-tone-danger-fg text-tone-danger-emphasis-fg",
  ghost: "border border-transparent bg-surface-muted text-fg",
  link: "border border-transparent text-link-hover underline underline-offset-2",
};

/** Hover and focus as props, never real pointer state, so a screenshot reproduces them. */
export function Button({
  variant = "secondary",
  size = "sm",
  state = "rest",
  leading,
  trailing,
  children,
}: {
  variant?: ButtonVariant;
  size?: keyof typeof BUTTON_SIZE;
  state?: ButtonState;
  leading?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  const look = state === "hover" ? BUTTON_HOVER[variant] : BUTTON_REST[variant];
  const focus =
    state === "focus"
      ? "[outline:var(--ui-focus-ring)] [outline-offset:var(--ui-focus-ring-offset)]"
      : "";
  const dim = state === "disabled" ? "opacity-50" : "";
  const pad = variant === "link" ? "px-0" : "";
  return (
    <span
      role="button"
      aria-disabled={state === "disabled" || undefined}
      className={`inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-control font-(--ui-weight-medium) transition-colors duration-150 ${BUTTON_SIZE[size]} ${look} ${focus} ${dim} ${pad}`}
    >
      {state === "loading" ? <RunSpinner tone="inherit" /> : leading}
      {children}
      {trailing}
    </span>
  );
}

/** A square icon button: flat at rest, its ink deepening on hover, filled only when pressed. */
export function IconButton({
  label,
  icon,
  size = "md",
  pressed = false,
  hovered = false,
}: {
  label: string;
  icon: IconName;
  size?: "sm" | "md";
  pressed?: boolean;
  hovered?: boolean;
}) {
  const box = size === "md" ? "size-8" : "size-6";
  const ink = pressed ? "bg-surface-muted text-fg" : hovered ? "text-fg" : "text-fg-subtle";
  return (
    <span
      role="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed || undefined}
      className={`inline-flex ${box} shrink-0 items-center justify-center rounded-control transition-colors duration-150 ${ink}`}
    >
      <GlyphIcon name={icon} size={size === "md" ? 16 : 14} />
    </span>
  );
}

export function Link({ children, external = false }: { children: ReactNode; external?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 text-link underline decoration-current/40 underline-offset-2">
      {children}
      {external && <GlyphIcon name="external" size={12} />}
    </span>
  );
}

export function Kbd({ keys }: { keys: readonly string[] }) {
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((key) => (
        <kbd
          key={key}
          className="inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-line bg-surface px-1 font-mono text-xs tabular-nums text-fg-muted"
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// Status (W1: Badge, Count, Skeleton, EmptyState; W4: Notice, ProgressBar)
// ---------------------------------------------------------------------------------------------

/** Soft: tint and ink on the neutral hairline; outline: the tone's line and ink; solid: emphasis. */
export function Badge({
  tone = "neutral",
  variant = "soft",
  children,
}: {
  tone?: ToneName;
  variant?: "soft" | "outline" | "solid";
  children: ReactNode;
}) {
  const look =
    variant === "solid"
      ? `border border-transparent ${TONE_SOLID[tone]}`
      : variant === "outline"
        ? `border ${TONE_LINE[tone]} ${TONE_INK[tone]}`
        : `border border-line ${TONE_TINT[tone]} ${TONE_INK[tone]}`;
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-[var(--ui-radius-pill)] px-1.5 text-xs font-(--ui-weight-medium) ${look}`}
    >
      {children}
    </span>
  );
}

export function Count({ n, max = 99 }: { n: number; max?: number }) {
  return (
    <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-[var(--ui-radius-pill)] bg-tone-neutral-bg px-1.5 text-xs tabular-nums text-fg-muted">
      {n > max ? `${max}+` : n}
    </span>
  );
}

/** A run state as a glyph or a spinner in tone ink, with its word. */
export function StatusWord({
  tone,
  icon,
  children,
}: {
  tone: ToneName;
  icon?: IconName | "spinner";
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-(--ui-weight-medium) ${TONE_INK[tone]}`}
    >
      {icon === "spinner" ? (
        <RunSpinner tone={tone} />
      ) : icon ? (
        <GlyphIcon name={icon} size={13} />
      ) : (
        <Dot tone={tone} size="xs" />
      )}
      {children}
    </span>
  );
}

/**
 * A strip is a neutral surface with a hairline and the tone in its glyph and title; a callout (for
 * danger or attention, one per view) takes the tone's fill on the neutral line; inline is a line of
 * text under a field or a row.
 */
export function Notice({
  tone,
  variant = "strip",
  title,
  children,
  action,
}: {
  tone: ToneName;
  variant?: "strip" | "callout" | "inline";
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  if (variant === "inline") {
    return (
      <p className={`flex items-center gap-1.5 text-sm ${TONE_INK[tone]}`}>
        <GlyphIcon name={TONE_GLYPH[tone]} size={14} />
        <span className="min-w-0 flex-1">{children}</span>
        {action}
      </p>
    );
  }
  const box =
    variant === "callout"
      ? `border border-line ${TONE_TINT[tone]}`
      : "border border-line bg-surface";
  return (
    <div role="status" className={`flex items-start gap-2 rounded-md px-3 py-2 ${box}`}>
      <span className={`pt-0.5 ${TONE_INK[tone]}`}>
        <GlyphIcon name={TONE_GLYPH[tone]} size={15} />
      </span>
      <div className="min-w-0 flex-1 text-sm">
        {title && <p className="font-(--ui-weight-medium) text-fg">{title}</p>}
        {children && <p className="text-fg-muted">{children}</p>}
      </div>
      {action}
    </div>
  );
}

export function ProgressBar({
  value,
  tone = "neutral",
  label,
}: {
  /** 0–1. */
  value: number;
  tone?: ToneName;
  label: string;
}) {
  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      className="block h-1.5 w-full overflow-hidden rounded-[var(--ui-radius-pill)] bg-tone-neutral-bg"
    >
      <span
        className={`block h-full ${TONE_DOT[tone]}`}
        style={{ width: `${Math.min(100, value * 100)}%` }}
      />
    </span>
  );
}

/** A placeholder bar; W1's `Skeleton` adds the arrival pulse. */
export function Skeleton({ className }: { className: string }) {
  return <span aria-hidden className={`block rounded-xs bg-surface-muted ${className}`} />;
}

export function EmptyState({
  title,
  description,
  action,
  variant = "page",
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  variant?: "page" | "slot";
}) {
  if (variant === "slot") {
    return (
      <div className="rounded-md border border-dashed border-line px-4 py-6 text-center text-sm text-fg-muted">
        <p className="font-(--ui-weight-medium) text-fg">{title}</p>
        {description && <p className="mt-1">{description}</p>}
        {action && <div className="mt-3 flex justify-center">{action}</div>}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <h1 className="ui-display font-(family-name:--ui-h3-font) text-(length:--ui-h3-size) leading-(--ui-h3-lh) font-(--ui-h3-weight) text-fg">
        {title}
      </h1>
      {description && <p className="mt-2 max-w-sm text-sm text-fg-muted">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Type and layout (W4/W5: Heading, Text, Card, RuledSection, PageHeader, KeyValue)
// ---------------------------------------------------------------------------------------------

const HEADING = {
  1: "font-(family-name:--ui-h1-font) text-(length:--ui-h1-size) leading-(--ui-h1-lh) font-(--ui-h1-weight) tracking-(--ui-h1-tracking)",
  2: "font-(family-name:--ui-h2-font) text-(length:--ui-h2-size) leading-(--ui-h2-lh) font-(--ui-h2-weight) tracking-(--ui-h2-tracking)",
  3: "font-(family-name:--ui-h3-font) text-(length:--ui-h3-size) leading-(--ui-h3-lh) font-(--ui-h3-weight) tracking-(--ui-h3-tracking)",
  4: "font-(family-name:--ui-h4-font) text-(length:--ui-h4-size) leading-(--ui-h4-lh) font-(--ui-h4-weight) tracking-(--ui-h4-tracking)",
  5: "font-(family-name:--ui-h5-font) text-(length:--ui-h5-size) leading-(--ui-h5-lh) font-(--ui-h5-weight) tracking-(--ui-h5-tracking)",
} as const;

/** A heading on the role scale. Level 1 is a page or hero title and wears the display face. */
export function Heading({
  level,
  children,
  className = "",
}: {
  level: keyof typeof HEADING;
  children: ReactNode;
  className?: string;
}) {
  const style = `${HEADING[level]} text-fg ${className}`;
  switch (level) {
    case 1:
      return <h1 className={`ui-display ${style}`}>{children}</h1>;
    case 2:
      return <h2 className={style}>{children}</h2>;
    case 3:
      return <h3 className={style}>{children}</h3>;
    case 4:
      return <h4 className={style}>{children}</h4>;
    default:
      return <h5 className={style}>{children}</h5>;
  }
}

/** A group label naming the items below it (the eyebrow): the theme decides its case. */
export function Text({ variant, children }: { variant: "eyebrow"; children: ReactNode }) {
  return (
    <p
      data-variant={variant}
      className="ui-eyebrow text-xs font-(--ui-weight-medium) text-fg-muted"
    >
      {children}
    </p>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-line bg-surface ${className}`}>{children}</div>;
}

/** A hairline section: the title on the left, its count and actions on the right. */
export function RuledSection({
  title,
  description,
  count,
  actions,
  children,
}: {
  title: string;
  description?: string;
  count?: number;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-line pt-4">
      <div className="flex items-center gap-2">
        <Heading level={4}>{title}</Heading>
        {count !== undefined && <Count n={count} />}
        <span className="min-w-0 flex-1" />
        {actions}
      </div>
      {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** The page title (h2), its "?" and the toolbar. No eyebrow: a page names itself. */
export function PageHeader({
  title,
  info,
  actions,
}: {
  title: string;
  info?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center gap-2">
      <Heading level={2}>{title}</Heading>
      {info && (
        <span title={info} className="text-fg-subtle">
          <GlyphIcon name="help" size={16} />
        </span>
      )}
      <span className="min-w-0 flex-1" />
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

export function KeyValue({
  items,
  columns = 3,
}: {
  items: readonly { label: string; value: string; mono?: boolean }[];
  columns?: 2 | 3;
}) {
  return (
    <dl className={`grid gap-x-6 gap-y-3 ${columns === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs text-fg-muted">{item.label}</dt>
          <dd
            className={`truncate text-sm font-(--ui-weight-medium) tabular-nums text-fg ${item.mono ? "font-mono" : ""}`}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------------------------
// Navigation (W4: Tabs, NavRow, GroupHeader, Breadcrumbs)
// ---------------------------------------------------------------------------------------------

export function Tabs({ items, active }: { items: readonly string[]; active: number }) {
  return (
    <div role="tablist" className="ui-underline-nav flex gap-4 border-b border-line">
      {items.map((item, i) => (
        <span
          key={item}
          role="tab"
          aria-selected={i === active}
          className={`px-0.5 pb-2 pt-1 text-sm ${i === active ? "font-(--ui-weight-medium) text-fg" : "text-fg-muted"}`}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

export function NavRow({
  icon,
  label,
  count,
  active = false,
}: {
  icon: IconName;
  label: string;
  count?: number;
  active?: boolean;
}) {
  return (
    <span
      className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm ${
        active ? "bg-accent-muted font-(--ui-weight-medium) text-fg" : "text-fg-muted"
      }`}
    >
      <GlyphIcon name={icon} size={16} className={active ? "text-fg" : "text-fg-subtle"} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && <Count n={count} />}
    </span>
  );
}

/** A collapsible group's header: the label names the rows below it. */
export function GroupHeader({
  label,
  name = false,
  count,
  icon,
  open = true,
  actions,
}: {
  label: string;
  /** The label is a name (a Workspace folder), set as written rather than as a group label. */
  name?: boolean;
  count?: number;
  icon?: IconName;
  open?: boolean;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 px-2 pb-1 pt-3 text-fg-subtle">
      {icon && <GlyphIcon name={icon} size={14} />}
      {name ? (
        <span className="min-w-0 truncate text-xs font-(--ui-weight-medium) text-fg-muted">
          {label}
        </span>
      ) : (
        <span className="ui-eyebrow min-w-0 truncate text-xs font-(--ui-weight-medium) text-fg-muted">
          {label}
        </span>
      )}
      {count !== undefined && <span className="text-xs tabular-nums">{count}</span>}
      <GlyphIcon name={open ? "chevronDown" : "chevronRight"} size={12} />
      <span className="min-w-0 flex-1" />
      {actions}
    </div>
  );
}

export function Breadcrumbs({ items }: { items: readonly string[] }) {
  return (
    <nav aria-label="Breadcrumbs" className="flex min-w-0 items-center gap-1 text-sm">
      {items.map((item, i) => {
        // The leaf keeps its name; only the folders above it give up room.
        const leaf = i === items.length - 1;
        return (
          <span key={item} className={`flex items-center gap-1 ${leaf ? "shrink-0" : "min-w-0"}`}>
            {i > 0 && <GlyphIcon name="chevronRight" size={12} className="text-fg-subtle" />}
            <span className={leaf ? "text-fg" : "truncate text-fg-muted"}>{item}</span>
          </span>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------------------------
// Overlays (W3: FloatingPanel, MenuItem, MenuLabel, Tooltip, Modal, Toaster)
// ---------------------------------------------------------------------------------------------

/**
 * The shell every menu and popover shares. Its children round at the inner radius: the panel's
 * radius less its padding.
 */
export function FloatingPanel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`ui-glass rounded-md border border-line bg-overlay p-1 shadow-lg [--radius-inner:max(var(--ui-radius-xs),calc(var(--ui-radius-md)-0.25rem))] ${className}`}
    >
      {children}
    </div>
  );
}

export function MenuItem({
  icon,
  label,
  description,
  shortcut,
  danger = false,
  active = false,
  checked = false,
}: {
  icon?: IconName;
  label: string;
  description?: string;
  shortcut?: readonly string[];
  danger?: boolean;
  active?: boolean;
  checked?: boolean;
}) {
  const ink = danger ? "text-tone-danger-fg" : "text-fg";
  return (
    <span
      role="menuitem"
      className={`flex items-center gap-2 rounded-[var(--radius-inner)] px-2 ${description ? "py-1.5" : "py-1"} text-sm ${ink} ${
        active ? "bg-surface-muted" : ""
      }`}
    >
      {icon && <GlyphIcon name={icon} size={14} className={danger ? "" : "text-fg-muted"} />}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {description && <span className="block truncate text-xs text-fg-muted">{description}</span>}
      </span>
      {checked && <GlyphIcon name="check" size={14} className="text-fg-muted" />}
      {shortcut && <Kbd keys={shortcut} />}
    </span>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <p className="ui-eyebrow px-2 pb-1 pt-1.5 text-xs font-(--ui-weight-medium) text-fg-muted">
      {children}
    </p>
  );
}

export function MenuSeparator() {
  return <span role="separator" className="my-1 block h-px bg-line-muted" />;
}

export function Tooltip({ label }: { label: string }) {
  return (
    <span
      role="tooltip"
      className="ui-glass inline-block whitespace-nowrap rounded-sm border border-line bg-overlay px-2 py-1 text-xs text-fg shadow-lg"
    >
      {label}
    </span>
  );
}

export function Modal({
  title,
  description,
  children,
  footer,
  className = "",
}: {
  title?: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="dialog"
      aria-label={title}
      className={`ui-glass overflow-hidden rounded-lg border border-line bg-overlay shadow-xl ${className}`}
    >
      {(title || description) && (
        <div className="px-5 pb-2 pt-4">
          {title && <Heading level={3}>{title}</Heading>}
          {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
        </div>
      )}
      {children}
      {footer && <div className="flex items-center justify-end gap-2 px-5 pb-4 pt-3">{footer}</div>}
    </div>
  );
}

/** A toast: a neutral surface and hairline; the tone is in its glyph. */
export function Toast({
  tone,
  title,
  description,
  action,
}: {
  tone: ToneName;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div
      role="status"
      className="flex w-full max-w-80 items-start gap-2 rounded-md border border-line bg-overlay px-3 py-2 shadow-lg"
    >
      <span className={`pt-0.5 ${TONE_INK[tone]}`}>
        <GlyphIcon name={TONE_GLYPH[tone]} size={15} />
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-(--ui-weight-medium) text-fg">{title}</p>
        {description && <p className="text-fg-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Forms (W2: Field, Input, Select, Checkbox, Radio, Switch, Segmented, SearchInput, SwatchPicker)
// ---------------------------------------------------------------------------------------------

export type FieldState = "rest" | "focus" | "error" | "disabled";

const CONTROL_STATE: Record<FieldState, string> = {
  rest: "border-line-emphasis bg-surface",
  focus: "border-accent bg-surface [box-shadow:var(--ui-focus-ring-input)]",
  error: "border-tone-danger-emphasis bg-surface",
  disabled: "border-line bg-surface-muted opacity-60",
};

export function Field({
  label,
  hint,
  error,
  required = false,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
      <span className="flex items-center gap-1 text-sm font-(--ui-weight-medium) text-fg">
        {label}
        {required && (
          <span aria-hidden className="text-tone-danger-fg">
            *
          </span>
        )}
      </span>
      {children}
      {error ? (
        <span className="flex items-center gap-1 text-xs text-tone-danger-fg">
          <GlyphIcon name="circleCross" size={12} />
          {error}
        </span>
      ) : (
        hint && <span className="text-xs text-fg-muted">{hint}</span>
      )}
    </div>
  );
}

export function Input({
  value,
  placeholder,
  leading,
  trailing,
  state = "rest",
  mono = false,
  multiline = false,
}: {
  value?: string;
  placeholder?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  state?: FieldState;
  mono?: boolean;
  multiline?: boolean;
}) {
  return (
    <span
      className={`flex w-full ${multiline ? "min-h-20 items-start py-2" : "h-9 items-center"} gap-2 rounded-md border px-3 text-sm ${CONTROL_STATE[state]}`}
    >
      {leading && <span className="shrink-0 text-fg-subtle">{leading}</span>}
      <span
        className={`min-w-0 flex-1 ${multiline ? "whitespace-pre-wrap" : "truncate"} ${value ? "text-fg" : "text-fg-subtle"} ${mono ? "font-mono" : ""}`}
      >
        {value || placeholder}
        {state === "focus" && (
          <span aria-hidden className="ml-px inline-block h-4 w-px translate-y-0.5 bg-fg" />
        )}
      </span>
      {trailing && <span className="shrink-0 text-fg-subtle">{trailing}</span>}
    </span>
  );
}

export function Select({ value, state = "rest" }: { value: string; state?: FieldState }) {
  return (
    <Input value={value} state={state} trailing={<GlyphIcon name="chevronDown" size={14} />} />
  );
}

export function SearchInput({ value, placeholder }: { value?: string; placeholder: string }) {
  return (
    <span className="flex h-8 w-full min-w-40 items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-sm">
      <GlyphIcon name="search" size={14} className="text-fg-subtle" />
      <span className={`min-w-0 flex-1 truncate ${value ? "text-fg" : "text-fg-subtle"}`}>
        {value || placeholder}
      </span>
      {value && <GlyphIcon name="cross" size={12} className="text-fg-subtle" />}
    </span>
  );
}

export function Checkbox({
  checked,
  label,
  hint,
  disabled = false,
}: {
  checked: boolean;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <span className={`flex items-start gap-2 ${disabled ? "opacity-60" : ""}`}>
      <span
        aria-hidden
        className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-xs border ${
          checked ? "border-accent bg-accent text-accent-fg" : "border-line-emphasis bg-surface"
        }`}
      >
        {checked && <GlyphIcon name="check" size={12} />}
      </span>
      <span className="text-sm">
        <span className="block text-fg">{label}</span>
        {hint && <span className="block text-xs text-fg-muted">{hint}</span>}
      </span>
    </span>
  );
}

export function Radio({
  checked,
  label,
  hint,
}: {
  checked: boolean;
  label: string;
  hint?: string;
}) {
  return (
    <span className="flex items-start gap-2">
      <span
        aria-hidden
        className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border ${
          checked ? "border-accent" : "border-line-emphasis"
        } bg-surface`}
      >
        {checked && <span className="size-2 rounded-full bg-accent" />}
      </span>
      <span className="text-sm">
        <span className="block text-fg">{label}</span>
        {hint && <span className="block text-xs text-fg-muted">{hint}</span>}
      </span>
    </span>
  );
}

/**
 * A switch: its track is round in every theme, like the state dots. The knob is light in both
 * modes, as the app's is, and keeps a hairline so it still reads on a near-white accent (Primer's
 * dark one).
 */
export function Switch({ on, disabled = false }: { on: boolean; disabled?: boolean }) {
  return (
    <span
      role="switch"
      aria-checked={on}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full ${on ? "bg-accent" : "bg-line-emphasis"} ${
        disabled ? "opacity-50" : ""
      }`}
    >
      <span
        className={`absolute size-4 rounded-full border border-line bg-tone-neutral-emphasis-fg ${on ? "left-4.5" : "left-0.5"}`}
      />
    </span>
  );
}

export function Segmented({
  options,
  value,
  disabled = false,
}: {
  options: readonly string[];
  value: number;
  disabled?: boolean;
}) {
  return (
    <span
      className={`inline-flex gap-px rounded-control bg-surface-muted p-px ${disabled ? "opacity-60" : ""}`}
    >
      {options.map((option, i) => (
        <span
          key={option}
          className={`rounded-control px-2.5 py-0.5 text-xs ${
            i === value ? "bg-surface font-(--ui-weight-medium) text-fg shadow-sm" : "text-fg-muted"
          }`}
        >
          {option}
        </span>
      ))}
    </span>
  );
}

/** Round swatches in the presets' own colours, the selected one ringed. */
export function SwatchPicker({
  value,
  swatches,
}: {
  value: number;
  swatches: readonly AccentSwatchFixture[];
}) {
  return (
    <span className="flex items-center gap-2">
      {swatches.map((swatch, i) => (
        <span
          key={swatch.id}
          role="radio"
          aria-checked={i === value}
          aria-label={swatch.label}
          style={{ background: swatch.color }}
          className={`size-5 rounded-full ${i === value ? "outline-2 outline-offset-2 outline-line-emphasis" : ""}`}
        />
      ))}
    </span>
  );
}

/** A preference row: the label (with its "?") and hint on the left, the control on the right. */
export function PrefRow({
  label,
  hint,
  info = false,
  control,
}: {
  label: string;
  hint?: string;
  info?: boolean;
  control: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div className="min-w-0">
        <p className="flex items-center gap-1 text-sm font-(--ui-weight-medium) text-fg">
          {label}
          {info && <GlyphIcon name="help" size={14} className="text-fg-subtle" />}
        </p>
        {hint && <p className="mt-0.5 text-xs text-fg-muted">{hint}</p>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}
