/**
 * The WebApp composition module: the app's frame and its router. Features reach it only through its slots —
 * a page is a contribution to `WebAppModule.pages` with the component bound by id, a provider of
 * the signed-in session one to `sessionProviders`, an overlay or a headless runtime one to
 * `layers` (beside the columns, or over the page area with `area: "page"`), a component a
 * server-contributed page may name as its `builtin` renderer one to `pageRenderers` — so WebApp
 * imports no feature. What it provides is the root component the app mounts, with the
 * contributions bound into it (web-app/deps.ts), and the user event handlers the sessions module
 * collects (state/user-events.ts), which the router hands to the session list. The layout mounts
 * the sidebar module's column and rail, and opens the chat module's drafts on the New chat
 * command.
 *
 * The kernel addresses a slot by the providing MODULE's name (`WebAppModule.pages`), while the
 * slot declaration hangs on the interface the module provides (`WebAppSlots` beside `WebApp`) —
 * the same split as the server's `HttpModule.routes` and `HttpSlots`.
 */
import type { ComponentType, ReactNode } from "react";
import {
  Interface,
  Module,
  Provide,
  Use,
  type ClassCtx,
  type Contributed,
  type Slot,
} from "@prismshadow/penguin-core/kernel";

import type { UserEventHandlers } from "../state/user-events";
import type { ChatDrafts } from "../features/chat";
import type { Sidebar } from "./sidebar/iface";
import { webAppDeps, type WebAppLayer, type WebAppSessionProvider } from "./deps";

import { pageTableOf, type PageData } from "./page-table";

import { AppRouter, type AppRouterProps } from "./router";

@Interface()
export abstract class WebApp {
  /** The whole routed app, everything it renders under WebApp's bindings. */
  abstract readonly Root: ComponentType<AppRouterProps>;
}

/** The data half of a `sessionProviders` or `layers` contribution. */
export interface Ordered {
  /** The contribution's place in its slot, ascending. */
  order: number;
}

/** The data half of a `layers` contribution. */
export interface LayerData extends Ordered {
  /**
   * `"page"`: mounted inside the main column after the page, in the page's own box, for a layer
   * whose surfaces cover the page and must outlive it (the App Center's running apps): they take
   * the page's size and follow every resize without measuring anything. Absent: beside the
   * columns, like every overlay and headless runtime.
   */
  area?: "page";
}

/** The data half of a `pageRenderers` contribution: the name a server-contributed page's `builtin` renderer gives. */
export interface PageRendererData {
  name: string;
}

export interface WebAppSlots {
  /** A routed page; its component is the code half. */
  pages: Slot<PageData, ComponentType>;
  /** Providers of the signed-in session, mounted inside Project + Sessions, outermost first. */
  sessionProviders: Slot<Ordered, ComponentType<{ children: ReactNode }>>;
  /** Mounted once beside every page: overlays and headless runtimes, or over the page area. */
  layers: Slot<LayerData, ComponentType>;
  /** A component a page the server contributes (web-app/contributions.tsx) may name to be drawn with. */
  pageRenderers: Slot<PageRendererData, ComponentType>;
}

/** A slot's contributions by `order`, each with the component its module bound and its data. */
function byOrder<P, D extends Ordered = Ordered>(
  contributions: readonly Contributed[],
): ReadonlyArray<{ id: string; Component: ComponentType<P>; data: D }> {
  return [...contributions]
    .map((c) => ({ id: c.id, Component: c.code as ComponentType<P>, data: c.data as unknown as D }))
    .sort((a, b) => a.data.order - b.data.order);
}

@Module()
export class WebAppModule {
  @Provide() webApp!: WebApp;
  @Use() userEventHandlers!: UserEventHandlers;
  @Use() sidebar!: Sidebar;
  @Use() drafts!: ChatDrafts;
  setup({ contributions }: ClassCtx) {
    const pages = pageTableOf(contributions.pages ?? []);
    const sessionProviders: readonly WebAppSessionProvider[] = byOrder<{ children: ReactNode }>(
      contributions.sessionProviders ?? [],
    );
    const layers: readonly WebAppLayer[] = byOrder<unknown, LayerData>(
      contributions.layers ?? [],
    ).map(({ id, Component, data }) => ({
      id,
      Component,
      area: data.area === "page" ? "page" : "shell",
    }));
    const pageRenderers: ReadonlyMap<string, ComponentType> = new Map(
      (contributions.pageRenderers ?? []).map((c) => [
        (c.data as unknown as PageRendererData).name,
        c.code as ComponentType,
      ]),
    );
    const userEvents = this.userEventHandlers.all();
    this.webApp = {
      Root: webAppDeps.provide(
        {
          pages,
          pageRenderers,
          sessionProviders,
          layers,
          userEvents,
          sidebar: this.sidebar,
          drafts: this.drafts,
        },
        AppRouter,
      ),
    };
  }
}
