import { useEffect, useMemo, useState } from "react";
import { Button, Select, Tabs, toastSuccess, UiStringsProvider } from "@prismshadow/penguin-ui";
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

const NEW_ORG = "__new";

function isTab(route: Route): route is TabRoute {
  return (TAB_ROUTES as readonly Route[]).includes(route);
}

export function CompanyApp() {
  const lang = useHostLang();
  const w = lang === "zh" ? zh : en;
  const [place, setPlace] = useHostPlace();
  const [orgs, setOrgs] = useState<Org[]>(() => demoOrgs(lang));
  const [orgId, setOrgId] = useState(() => orgs[0]!.id);

  useEffect(() => {
    setOrgs(demoOrgs(lang));
    setOrgId("docs-site");
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

  const waiting = model.waitingOnYou(org).length;
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
              <div className="w-56 max-w-full">
                <Select
                  size="sm"
                  aria-label={w.org.switch}
                  value={place.route === "/new" ? NEW_ORG : org.id}
                  onChange={(event) => {
                    const next = event.target.value;
                    if (next === NEW_ORG) go("/new");
                    else {
                      setOrgId(next);
                      go("/");
                    }
                  }}
                >
                  {orgs.map((one) => (
                    <option key={one.id} value={one.id}>
                      {one.name}
                    </option>
                  ))}
                  <option value={NEW_ORG}>{w.org.create}</option>
                </Select>
              </div>
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
                    ...(route === "/" && waiting > 0 ? { badge: String(waiting) } : {}),
                  }))}
                  active={place.route}
                  onChange={go}
                />
              </div>
            )}
          </header>
          <main className="min-h-0 flex-1 overflow-y-auto">
            {place.route === "/" && <InboxPage />}
            {place.route === "/tickets" && <TicketsPage />}
            {place.route === "/team" && <TeamPage />}
            {place.route === "/handbook" && <HandbookPage />}
            {place.route === "/new" && (
              <NewOrgPage onCreate={create} back={{ label: org.name, onClick: () => go("/") }} />
            )}
            <p className="px-4 pb-6 text-center text-xs text-fg-subtle sm:px-6">{w.draftNote}</p>
          </main>
          <TicketDrawer />
        </div>
      </CompanyContext.Provider>
    </UiStringsProvider>
  );
}
