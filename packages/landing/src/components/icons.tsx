/**
 * Inline icon set (lucide-style 24x24 stroke icons + the GitHub mark). Kept local so
 * the landing page has zero icon dependencies; all icons inherit currentColor.
 */
import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function GitHubIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 5.74 0c2.18-1.49 3.14-1.18 3.14-1.18.63 1.59.24 2.76.12 3.05.74.81 1.18 1.83 1.18 3.09 0 4.41-2.69 5.38-5.25 5.67.41.35.78 1.05.78 2.12 0 1.53-.02 2.76-.02 3.14 0 .3.21.67.8.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

/** Platform marks copied from the ZCode download page so both sites use the same glyphs. */
export function MacOSIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" {...props}>
      <path
        fill="currentColor"
        d="M25.547 11.131a5.89 5.89 0 0 0-2.814 4.955 5.73 5.73 0 0 0 3.488 5.257 13.7 13.7 0 0 1-1.786 3.69c-1.112 1.601-2.275 3.202-4.044 3.202-1.77 0-2.225-1.028-4.264-1.028-1.988 0-2.696 1.062-4.314 1.062s-2.746-1.483-4.044-3.303a15.96 15.96 0 0 1-2.713-8.61c0-5.056 3.286-7.735 6.521-7.735 1.72 0 3.152 1.128 4.23 1.128 1.028 0 2.629-1.196 4.584-1.196a6.13 6.13 0 0 1 5.156 2.578m-6.083-4.718a5.8 5.8 0 0 0 1.382-3.622 2.5 2.5 0 0 0-.05-.522A5.82 5.82 0 0 0 16.97 4.24a5.65 5.65 0 0 0-1.432 3.522q0 .239.05.472.176.033.354.034a5.05 5.05 0 0 0 3.522-1.855"
      />
    </svg>
  );
}

export function WindowsIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" {...props}>
      <path fill="#DD5B34" d="M5 5h10v10H5z" />
      <path fill="#F1B941" d="M17 17h10v10H17z" />
      <path fill="#49A1E8" d="M5 17h10v10H5z" />
      <path fill="#8BB738" d="M17 5h10v10H17z" />
    </svg>
  );
}

export function LinuxIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" {...props}>
      <path
        fill="#ECEFF1"
        d="m12.267 9.498.082 1.9-1.322 2.48-2.066 4.048-.413 3.387 1.488 4.793 3.387 1.9h5.123l4.792-3.636 2.148-5.7-4.957-6.032-1.405-3.388z"
      />
      <path
        fill="#263238"
        d="M24 14.208c-1.323-1.9-2.397-3.058-2.975-5.454s.165-1.735-.33-3.8a6.5 6.5 0 0 0-1.075-2.397c-.496-.578-1.074-.908-1.404-.991-.744-.413-2.48-1.074-4.627.083-2.231 1.156-1.983 3.635-1.57 8.675 0 .33-.083.744-.248 1.074-.33.744-.91 1.405-1.405 1.983-.578.827-1.157 1.653-1.57 2.562-.991 1.9-1.9 4.296-1.652 5.205.413-.082 5.618 7.85 5.618 8.015.33-.083 1.735-.083 2.975-.083 1.735-.082 2.726-.165 4.131.165 0-.248-.083-.495-.083-.743 0-.496.083-.91.166-1.487.082-.414.165-.827.248-1.323-.827.744-2.314 1.57-3.719 1.818-1.239.248-3.305-.165-4.296-1.404.083 0 .248 0 .33-.083.248-.083.496-.165.579-.33.248-.414.082-.827-.083-1.075-.165-.247-1.404-1.156-1.983-1.652-.578-.496-.909-.744-1.24-1.074l-.66-.661c-.165-.166-.248-.33-.33-.413-.166-.414-.249-.91-.166-1.57.083-.91.413-1.653.826-2.479.166-.33.579-.991.579-.991s-1.405 3.47-.661 4.544c0 0 .082-1.074.413-2.148.248-.744.66-1.818 1.157-2.396.495-.579 1.735-2.727 1.817-4.05 0-.578.083-1.156.083-1.569-.33-.33 5.453-1.157 5.784-.248.082.33 1.24 3.305 1.9 4.875.33.744.744 1.405.992 2.23.247.91.413 2.15.413 3.389 0 .247 0 .66-.083 1.074.165 0 3.388-3.47-.413-6.362 0 0 2.313 1.074 2.396 3.222.083 1.735-.66 3.14-.826 3.388.082 0 1.735.743 1.818.743.33 0 .991-.248.991-.248.083-.248.33-.909.33-1.157.579-1.9-.826-4.957-2.148-6.857"
      />
      <path
        fill="#ECEFF1"
        d="M13.506 8.754c.593 0 1.074-.74 1.074-1.652 0-.913-.481-1.653-1.074-1.653s-1.074.74-1.074 1.653c0 .912.48 1.652 1.074 1.652M17.224 8.92c.776 0 1.405-.851 1.405-1.9 0-1.05-.63-1.901-1.405-1.901-.776 0-1.405.85-1.405 1.9s.63 1.9 1.405 1.9"
      />
      <path
        fill="#212121"
        d="M14.106 7.215c-.069-.543-.381-.951-.698-.911s-.518.513-.45 1.056c.069.543.381.951.698.911s.518-.513.45-1.056M17.142 8.424c.456 0 .826-.481.826-1.074s-.37-1.074-.826-1.074c-.457 0-.827.48-.827 1.074 0 .593.37 1.074.827 1.074"
      />
      <path
        fill="#FFC107"
        d="M28.13 25.527c-.33-.165-.908-.413-1.404-1.157-.248-.413-.165-1.57-.578-2.065-.248-.33-.579-.165-.662-.165-.743.165-2.478 1.322-3.635 0-.165-.166-.413-.414-.826-.414s-.579.166-.744.496-.165.579-.165 1.405c0 .66 0 1.404-.083 1.983-.165 1.404-.413 2.23-.413 3.057 0 .909.248 1.487.578 1.735.248.248.662.413 1.57.413.91 0 1.488-.33 2.066-.909.413-.413.744-.578 1.9-1.404.91-.579 2.314-1.322 2.562-1.57.165-.165.413-.248.413-.744 0-.413-.33-.578-.578-.66M11.523 25.775c-.826-1.322-.909-1.57-1.487-2.396-.496-.826-1.57-2.396-2.231-2.396-.496 0-.744.248-1.074.578s-.661 1.074-1.24 1.487c-.495.414-1.9.33-2.23.827-.33.495.33 1.239.33 2.478 0 .496-.413.827-.496 1.157-.082.413-.165.661 0 .992.33.495.744.66 3.553 1.239 1.488.33 2.892 1.157 3.801 1.24s2.479 0 2.479-2.232c.082-1.322-.661-1.652-1.405-2.974M13.093 10.82c-.496-.33-.909-.661-.909-1.157s.33-.66.826-1.074c.083-.083.992-.909 1.9-.909.91 0 1.984.579 2.397.744.744.165 1.487.33 1.405.909-.083.826-.166.991-.992 1.404-.578.166-1.652 1.074-2.396 1.074-.33 0-.826 0-1.157-.082-.248-.083-.66-.496-1.074-.91"
      />
      <path
        fill="#634703"
        d="M12.928 10.159c.165.165.413.33.66.413.166.083.414.165.414.165h.743c.414 0 .992-.165 1.57-.495.579-.248.661-.414 1.074-.579.413-.248.827-.496.661-.578-.165-.083-.33 0-.909.33-.495.33-.908.496-1.404.744-.248.083-.578.248-.826.248h-.744c-.248 0-.413-.083-.661-.165-.165-.083-.248-.166-.33-.166-.166-.082-.496-.413-.662-.495 0 0-.165 0-.082.082zM15.406 8.341c.083.165.248.165.33.248s.166.083.166.083c.083-.083 0-.248-.083-.248 0-.165-.413-.165-.413-.083M14.084 8.506c0 .083.165.166.165.083.083-.083.165-.165.248-.165.165-.083.083-.165-.165-.165-.165.082-.165.165-.248.247"
      />
      <path
        fill="#455A64"
        d="M22.1 23.131v.248c.164.33.577.413.908.413.496 0 .991-.33 1.24-.661 0-.083.082-.165.165-.248.165-.248.247-.413.33-.496 0 0-.083-.082-.083-.165-.082-.165-.33-.33-.66-.413-.248-.083-.662-.165-.827-.165-.743-.083-1.157.165-1.404.413 0 0 .082 0 .082.083a.75.75 0 0 1 .248.578c.083.165 0 .248 0 .413"
      />
    </svg>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </Icon>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </Icon>
  );
}

export function MonitorIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </Icon>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 6 9 17l-5-5" />
    </Icon>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </Icon>
  );
}

export function XIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M18 6 6 18M6 6l12 12" />
    </Icon>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12h14M12 5l7 7-7 7" />
    </Icon>
  );
}

export function TerminalIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m4 17 6-6-6-6M12 19h8" />
    </Icon>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
    </Icon>
  );
}

export function SlidersIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4" />
    </Icon>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 3l14 9-14 9V3Z" />
    </Icon>
  );
}

export function FeatherIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5ZM16 8 2 22M17.5 15H9" />
    </Icon>
  );
}

export function BotIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 8V4H8" />
      <rect x="4" y="8" width="16" height="12" rx="2" />
      <path d="M2 14h2M20 14h2M15 13v2M9 13v2" />
    </Icon>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5" />
    </Icon>
  );
}

/** Pair it with `animate-spin`: the gap in the ring is what makes the rotation readable. */
export function SpinnerIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M21 12a9 9 0 1 1-6.22-8.56" />
    </Icon>
  );
}

export function CpuIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <rect x="9.5" y="9.5" width="5" height="5" />
      <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
    </Icon>
  );
}

export function LayersIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 2 2 7l10 5 10-5-10-5ZM2 12l10 5 10-5M2 17l10 5 10-5" />
    </Icon>
  );
}

export function BlocksIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="8.5" y="14" width="7" height="7" rx="1" />
    </Icon>
  );
}

export function ShareIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.59 13.51 6.83 3.98M15.41 6.51 8.59 10.49" />
    </Icon>
  );
}

export function SparklesIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9.94 15.5a2 2 0 0 0-1.44-1.44L2.37 12.48a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.13a.5.5 0 0 1 .96 0l1.58 6.13a2 2 0 0 0 1.44 1.44l6.13 1.58a.5.5 0 0 1 0 .96l-6.13 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.13a.5.5 0 0 1-.96 0Z" />
      <path d="M20 3v4M22 5h-4" />
    </Icon>
  );
}

export function ActivityIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </Icon>
  );
}

export function BarChartIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 3v18h18M8 17v-3M13 17V9M18 17V5" />
    </Icon>
  );
}

export function HistoryIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5M12 7v5l4 2" />
    </Icon>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </Icon>
  );
}

export function PieChartIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M21.21 15.89A10 10 0 1 1 8 2.83M22 12A10 10 0 0 0 12 2v10Z" />
    </Icon>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.94a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1Z" />
    </Icon>
  );
}

export function ShieldCheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.94a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1Z" />
      <path d="m9 12 2 2 4-4" />
    </Icon>
  );
}

export function FrameIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 2v20M18 2v20M2 6h20M2 18h20" />
    </Icon>
  );
}

export function FileCheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4M9 15l2 2 4-4" />
    </Icon>
  );
}

export function MessageSquareIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
    </Icon>
  );
}

export function UsersIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </Icon>
  );
}

export function GlobeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z" />
    </Icon>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m15 18-6-6 6-6" />
    </Icon>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m9 18 6-6-6-6" />
    </Icon>
  );
}

export function ExternalLinkIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </Icon>
  );
}

export function LinkIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </Icon>
  );
}

export function KeyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78Zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </Icon>
  );
}
