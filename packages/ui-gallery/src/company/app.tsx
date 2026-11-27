import { useEffect, useRef, useState } from "react";
import {
  Button,
  ChevronDown,
  Dropdown,
  ICONS,
  MenuItem,
  MenuRadioItem,
  MenuSeparator,
  PageFrame,
  toastSuccess,
  UiStringsProvider,
} from "@prismshadow/penguin-ui";
import { uiStringsFor } from "../../../web/src/lib/ui-strings";
import { CompanyContext } from "./context";
import type { CompanyValue } from "./context";
import { demoOrgs, NEW_SESSION, orgFromTemplate } from "./fixtures";
import type { Template } from "./fixtures";
import { navigateHost, useHostLang, useHostRoute } from "./frame";
import { JobsPage } from "./jobs";
import * as model from "./model";
import type { Org } from "./model";
import { NewOrgPage } from "./new-org";
import { zh } from "./words";
import { en } from "./words-en";

export function CompanyApp() {
  const lang = useHostLang();
  const w = lang === "zh" ? zh : en;
  const [route, go] = useHostRoute();
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

  const create = (template: Template, goal: string) => {
    const made = orgFromTemplate(template, goal);
    setOrgs((all) => [...all.filter((one) => one.id !== made.id), made]);
    setOrgId(made.id);
    go("/");
    toastSuccess(w.create.created(made.name));
  };

  const value: CompanyValue = {
    w,
    lang,
    org,
    stop: (session) =>
      setOrgs((all) => all.map((one) => (one.id === org.id ? model.stop(one, session) : one))),
  };

  return (
    <UiStringsProvider strings={uiStringsFor(lang)}>
      <CompanyContext.Provider value={value}>
        <div className="flex h-full min-h-0 flex-col">
          <main className="min-h-0 flex-1">
            {route === "/new" ? (
              <NewOrgPage
                key={lang}
                w={w}
                lang={lang}
                onCreate={create}
                back={{ label: org.name, onClick: () => go("/") }}
              />
            ) : (
              <PageFrame width="sm">
                <header className="mb-3 flex flex-wrap items-center gap-2">
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
                    {org.goal}
                  </p>
                  <Button
                    size="sm"
                    variant="primary"
                    className="ml-auto"
                    data-tooltip={w.jobs.newJobHint}
                    data-tooltip-extra="true"
                    onClick={() => navigateHost(NEW_SESSION)}
                  >
                    {w.jobs.newJob}
                  </Button>
                </header>
                <JobsPage />
              </PageFrame>
            )}
          </main>
          <p className="shrink-0 px-4 py-2 text-center text-xs text-fg-subtle sm:px-6">
            {w.draftNote}
          </p>
        </div>
      </CompanyContext.Provider>
    </UiStringsProvider>
  );
}
