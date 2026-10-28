/** Controlled site preferences: persistence and translated labels belong to the host. */
import { useEffect, useState } from "react";
import { CheckLineIcon } from "../icons/marks/marks";
import { Dropdown } from "../overlays/dropdown/dropdown";
import { Menu, MenuRow } from "../overlays/menu/menu";
import {
  GitHubIcon,
  GlobeIcon,
  ChevronDownIcon,
  SunIcon,
  MoonIcon,
  MonitorIcon,
} from "./site-icons";

export type SiteThemeMode = "light" | "dark" | "system";
export type SiteLangPref = "en" | "zh" | "system";
const NEXT: Record<SiteThemeMode, SiteThemeMode> = {
  light: "dark",
  dark: "system",
  system: "light",
};

export function SiteThemeToggle({
  mode,
  onChange,
  labels,
}: {
  mode: SiteThemeMode;
  onChange: (mode: SiteThemeMode) => void;
  labels: Record<SiteThemeMode | "label", string>;
}) {
  const label = `${labels.label}: ${labels[mode]}`;
  const Icon = mode === "light" ? SunIcon : mode === "dark" ? MoonIcon : MonitorIcon;
  return (
    <button
      type="button"
      className="site-ui-icon-button"
      title={label}
      aria-label={label}
      onClick={() => onChange(NEXT[mode])}
    >
      <Icon className="h-[18px] w-[18px]" />
    </button>
  );
}

export function SiteLanguageMenu({
  value,
  onChange,
  labels,
}: {
  value: SiteLangPref;
  onChange: (value: SiteLangPref) => void;
  labels: Record<SiteLangPref | "label", string>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      portal={{ direction: "down", align: "right" }}
      menuClass="site-ui site-ui-language-panel"
      button={
        <button
          type="button"
          className="site-ui-language-trigger"
          title={labels.label}
          aria-label={labels.label}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <GlobeIcon className="h-[18px] w-[18px]" />
          <span className="hidden sm:inline">{labels[value]}</span>
          <ChevronDownIcon className="h-3.5 w-3.5" />
        </button>
      }
    >
      {/* The rows bring their own line check: the menu's own is drawn in every theme's icon set,
          which the sites never show and would otherwise ship. */}
      <Menu label={labels.label} density="md">
        {(["en", "zh", "system"] as const).map((option) => (
          <MenuRow
            key={option}
            role="menuitemradio"
            className="site-ui-language-option"
            label={labels[option]}
            checked={value === option}
            check={<CheckLineIcon className="site-ui-language-check" />}
            onSelect={() => {
              onChange(option);
              setOpen(false);
            }}
          />
        ))}
      </Menu>
    </Dropdown>
  );
}

export function SiteGitHubLink({
  href,
  apiUrl,
  label,
}: {
  href: string;
  apiUrl: string;
  label: string;
}) {
  const [stars, setStars] = useState<number | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setStars(null);
    void fetch(apiUrl, {
      signal: controller.signal,
      headers: { Accept: "application/vnd.github+json" },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { stargazers_count?: unknown } | null) => {
        if (!controller.signal.aborted && typeof data?.stargazers_count === "number")
          setStars(data.stargazers_count);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [apiUrl]);
  const count = stars?.toLocaleString("en-US");
  const name = count ? `${label} · ${count} stars` : label;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={name}
      aria-label={name}
      className="site-ui-github-link"
    >
      <GitHubIcon className="h-[18px] w-[18px]" />
      <span className="hidden min-w-8 tabular-nums min-[360px]:inline">{count ?? "-"}</span>
    </a>
  );
}
