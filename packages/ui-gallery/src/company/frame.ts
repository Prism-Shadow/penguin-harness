import { useEffect, useState } from "react";

export type Lang = "zh" | "en";

export const LOCATION_MESSAGE = "penguin:location";
export const NAVIGATE_MESSAGE = "penguin:navigate";

export const ROUTES = ["/", "/tickets", "/team", "/handbook", "/new"] as const;
export type Route = (typeof ROUTES)[number];

export interface Place {
  route: Route;
  ticket: string | null;
}

export function langOf(value: string | null | undefined): Lang {
  return value?.toLowerCase().startsWith("en") ? "en" : "zh";
}

export function placeOf(at: string): Place {
  const [path = "/", query = ""] = at.split("?");
  const route = (ROUTES as readonly string[]).includes(path) ? (path as Route) : "/";
  return { route, ticket: new URLSearchParams(query).get("ticket") };
}

export function atOf(place: Place): string {
  return place.ticket === null
    ? place.route
    : `${place.route}?${new URLSearchParams({ ticket: place.ticket }).toString()}`;
}

function framed(): boolean {
  return window.parent !== window;
}

function startLang(): Lang {
  const asked = new URLSearchParams(window.location.search).get("lang");
  return langOf(framed() || asked === null ? document.documentElement.lang : asked);
}

export function useHostLang(): Lang {
  const [lang, setLang] = useState<Lang>(startLang);
  useEffect(() => {
    if (!framed()) return;
    const root = document.documentElement;
    const observer = new MutationObserver(() => setLang(langOf(root.lang)));
    observer.observe(root, { attributes: true, attributeFilter: ["lang"] });
    return () => observer.disconnect();
  }, []);
  return lang;
}

function startAt(): string {
  const hash = decodeURIComponent(window.location.hash.slice(1));
  return hash.startsWith("/") ? hash : "/";
}

export function useHostPlace(): [Place, (next: Place) => void] {
  const [place, setPlace] = useState<Place>(() => placeOf(startAt()));
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== window.location.origin) return;
      const data = event.data as { type?: unknown; at?: unknown } | null;
      if (data?.type === LOCATION_MESSAGE && typeof data.at === "string")
        setPlace(placeOf(data.at));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  const go = (next: Place) => {
    setPlace(next);
    const at = atOf(next);
    if (framed()) window.parent.postMessage({ type: LOCATION_MESSAGE, at }, window.location.origin);
    else window.history.replaceState(null, "", `${window.location.search}#${at}`);
  };
  return [place, go];
}

export function navigateHost(to: string): void {
  if (framed()) window.parent.postMessage({ type: NAVIGATE_MESSAGE, to }, window.location.origin);
}
