/**
 * A plugin web half that contributes to every slot a plugin's web half reaches, and needs its
 * server module (`FixtureServerModule`) to be drawn. What each code half was called with is kept
 * in `seen`, for the suite to read.
 */
import { createElement } from "react";
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import type {
  DockLayoutListener,
  DockScopeChange,
  DockScopeListener,
  LinkAction,
  SessionHandover,
  SettingsSectionCode,
} from "@prismshadow/penguin-web-plugin";

export const seen = {
  scopes: [] as DockScopeChange[],
  layouts: 0,
  handovers: [] as Array<[string, string]>,
  pinned: [] as string[],
};

const FixtureLayer = () => createElement("p", null, "fixture layer");
const FixtureBoard = () => createElement("p", null, "fixture board");
const FixturePage = () => createElement("p", null, "fixture page");

const page: SettingsSectionCode = { label: () => "Board", Body: FixturePage };
const link: LinkAction = {
  row: (href) => ({ glyph: "", label: "Pin to board", onSelect: () => seen.pinned.push(href) }),
  subscribe: () => () => {},
};
const handover: SessionHandover = async (from, to) => {
  seen.handovers.push([from, to]);
};
const onScope: DockScopeListener = (change) => {
  seen.scopes.push(change);
};
const onLayout: DockLayoutListener = () => {
  seen.layouts += 1;
};

@Module({
  contributes: {
    "WebAppModule.serverModules": [{ id: "fixture.server", module: "FixtureServerModule" }],
    "WebAppModule.layers": [{ id: "fixture.layer", order: 90 }],
    "DockModule.panels": [
      {
        id: "fixture.panel",
        kind: "fixture.board",
        title: "Board",
        titleZh: "看板",
        icon: "puzzle",
        order: 90,
        lead: true,
      },
    ],
    "DockModule.scopeListeners": [{ id: "fixture.scope", order: 20 }],
    "DockModule.layoutListeners": [{ id: "fixture.layout", order: 20 }],
    "SettingsModule.sections": [
      {
        id: "fixture.page",
        key: "fixtureBoard",
        group: "personal",
        visibility: "everyone",
        icon: "puzzle",
        order: 75,
      },
    ],
    "ChatModule.sessionHandovers": [{ id: "fixture.handover", order: 20 }],
    "ChatModule.linkActions": [{ id: "fixture.link", order: 20 }],
  },
})
export class FixtureWebModule {
  @Bind("fixture.layer") layer = FixtureLayer;
  @Bind("fixture.panel") panel = FixtureBoard;
  @Bind("fixture.scope") scope = onScope;
  @Bind("fixture.layout") layout = onLayout;
  @Bind("fixture.page") page = page;
  @Bind("fixture.handover") handover = handover;
  @Bind("fixture.link") link = link;
}
