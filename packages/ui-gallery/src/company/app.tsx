import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  ChevronDown,
  Dropdown,
  ICONS,
  MenuItem,
  MenuRadioItem,
  MenuSeparator,
  Tabs,
  toastSuccess,
  UiStringsProvider,
} from "@prismshadow/penguin-ui";
import { uiStringsFor } from "../../../web/src/lib/ui-strings";
import { CompanyContext } from "./context";
import type { CompanyActions, CompanyValue } from "./context";
import { demoNotes, demoOrgs, LEAD_SESSION, orgFromTemplate } from "./fixtures";
import type { Template } from "./fixtures";
import { navigateHost, useHostLang, useHostPlace } from "./frame";
import type { Route } from "./frame";
import { InboxPage } from "./inbox";
import * as model from "./model";
import type { Org } from "./model";
import { NewOrgPage } from "./new-org";
import { HandbookPage, TeamPage } from "./people";
import { TicketDrawer, TicketsPage } from "./tickets";
import { zh } from "./words";
import { en } from "./words-en";

const TAB_ROUTES = ["/", "/tickets", "/team", "/handbook"] as const satisfies readonly Route[];
type TabRoute = (typeof TAB_ROUTES)[number];

function isTab(route: Route): route is TabRoute {
  return (TAB_ROUTES as readonly Route[]).includes(route);
}

export function CompanyApp() {
  const lang = useHostLang();
  const w = lang === "zh" ? zh : en;
  const [place, setPlace] = useHostPlace();
  const [orgs, setOrgs] = useState<Org[]>(() => demoOrgs(lang));
  const [orgId, setOrgId] = useState(() => orgs[0]!.id);

  const [menuOpen, setMenuOpen] = useState(false);
  const shownLang = useRef(lang);

  useEffect(() => {
    if (shownLang.current === lang) return;
    shownLang.current = lang;
    const fresh = demoOrgs(lang);
    setOrgs(fresh);
    setOrgId(fresh[0]!.id);
  }, [lang]);

  const org = orgs.find((one) => one.id === orgId) ?? orgs[0]!;
  const go = (route: Route) => setPlace({ route, ticket: null });

  const act = useMemo<CompanyActions>(() => {
    const notes = demoNotes(lang);
    const change = (update: (org: Org) => Org) =>
      setOrgs((all) => all.map((one) => (one.id === orgId ? update(one) : one)));
    return {
      decide: (ticket, answer) => change((o) => model.decide(o, ticket, answer, notes)),
      accept: (ticket) => change((o) => model.accept(o, ticket, notes)),
      sendBack: (ticket, note) => change((o) => model.sendBack(o, ticket, note, notes)),
      resume: (ticket) => change((o) => model.resume(o, ticket, notes)),
      stop: (ticket) => change((o) => model.stop(o, ticket, notes)),
      rollBack: (member) => change((o) => model.rollBack(o, member)),
    };
  }, [lang, orgId]);

  const create = (template: Template, goal: string) => {
    const made = orgFromTemplate(template, goal, lang);
    setOrgs((all) => [...all.filter((one) => one.id !== made.id), made]);
    setOrgId(made.id);
    go("/");
    toastSuccess(w.create.created(made.name));
  };

  const value: CompanyValue = {
    w,
    lang,
    org,
    place,
    go,
    openTicket: (ticket) => setPlace({ route: place.route, ticket }),
    act,
  };

  const tabLabel: Record<TabRoute, string> = {
    "/": w.nav.inbox,
    "/tickets": w.nav.tickets,
    "/team": w.nav.team,
    "/handbook": w.nav.handbook,
  };

  return (
    <UiStringsProvider strings={uiStringsFor(lang)}>
      <CompanyContext.Provider value={value}>
        <div className="flex h-full min-h-0 flex-col">
          <header className="shrink-0 px-4 pt-3 sm:px-6">
            <div className="flex flex-wrap items-center gap-2">
              <Dropdown
                open={menuOpen}
                setOpen={setMenuOpen}
                className="max-w-full"
                menuClass="left-0 top-full mt-1 min-w-56 origin-top"
                button={
                  <Button
                    size="sm"
                    aria-label={`${w.org.switch} · ${org.name}`}
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    onClick={() => setMenuOpen(!menuOpen)}
                  >
                    <span className="max-w-48 truncate">{org.name}</span>
                    <ChevronDown />
                  </Button>
                }
              >
                {orgs.map((one) => (
                  <MenuRadioItem
                    key={one.id}
                    label={one.name}
                    checked={one.id === org.id}
                    onSelect={() => {
                      setMenuOpen(false);
                      setOrgId(one.id);
                      go("/");
                    }}
                  />
                ))}
                <MenuSeparator />
                <MenuItem
                  glyph={ICONS.plus}
                  label={w.org.create}
                  onSelect={() => {
                    setMenuOpen(false);
                    go("/new");
                  }}
                />
              </Dropdown>
              <p className="hidden min-w-0 flex-1 truncate text-xs text-fg-muted sm:block">
                {isTab(place.route) ? org.goal : ""}
              </p>
              <Button
                size="sm"
                data-tooltip={w.org.talkToLeadHint}
                data-tooltip-extra="true"
                onClick={() => navigateHost(LEAD_SESSION)}
              >
                {w.org.talkToLead}
              </Button>
            </div>
            {isTab(place.route) && (
              <div className="mt-2">
                <Tabs
                  items={TAB_ROUTES.map((route) => ({
                    key: route,
                    label: tabLabel[route],
                  }))}
                  active={place.route}
                  onChange={go}
                />
              </div>
            )}
          </header>
          <main className="min-h-0 flex-1">
            {place.route === "/" && <InboxPage />}
            {place.route === "/tickets" && <TicketsPage />}
            {place.route === "/team" && <TeamPage />}
            {place.route === "/handbook" && <HandbookPage />}
            {place.route === "/new" && (
              <NewOrgPage
                key={lang}
                onCreate={create}
                back={{ label: org.name, onClick: () => go("/") }}
              />
            )}
          </main>
          <p className="shrink-0 px-4 py-2 text-center text-xs text-fg-subtle sm:px-6">
            {w.draftNote}
          </p>
          <TicketDrawer />
        </div>
      </CompanyContext.Provider>
    </UiStringsProvider>
  );
}
