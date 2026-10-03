/**
 * The shell module: the app's frame and its router. Features reach it only through its slots —
 * a page is a contribution to `WebAppModule.pages` with the component bound by id, a provider of
 * the signed-in session one to `sessionProviders`, an overlay or a headless runtime one to
 * `layers` — so the shell imports no feature. What it provides is the root component the app
 * mounts, with the contributions bound into it (web-app/deps.ts), and the user event handlers
 * the sessions module collects (state/user-events.ts), which the router hands to the session
 * list. The layout mounts the sidebar module's column and rail, and opens the chat module's
 * drafts on the New chat command.
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
  /** The whole routed app, everything it renders under the shell's bindings. */
  abstract readonly Root: ComponentType<AppRouterProps>;
}

/** The data half of a `sessionProviders` or `layers` contribution. */
export interface Ordered {
  /** The contribution's place in its slot, ascending. */
  order: number;
}

export interface WebAppSlots {
  /** A routed page; its component is the code half. */
  pages: Slot<PageData, ComponentType>;
  /** Providers of the signed-in session, mounted inside Project + Sessions, outermost first. */
  sessionProviders: Slot<Ordered, ComponentType<{ children: ReactNode }>>;
  /** Mounted once beside every page: overlays and headless runtimes. */
  layers: Slot<Ordered, ComponentType>;
}

/** A slot's contributions by `order`, each with the component its module bound. */
function byOrder<P>(
  contributions: readonly Contributed[],
): ReadonlyArray<{ id: string; Component: ComponentType<P> }> {
  return [...contributions]
    .sort((a, b) => (a.data as unknown as Ordered).order - (b.data as unknown as Ordered).order)
    .map((c) => ({ id: c.id, Component: c.code as ComponentType<P> }));
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
    const layers: readonly WebAppLayer[] = byOrder(contributions.layers ?? []);
    const userEvents = this.userEventHandlers.all();
    this.webApp = {
      Root: webAppDeps.provide(
        { pages, sessionProviders, layers, userEvents, sidebar: this.sidebar, drafts: this.drafts },
        AppRouter,
      ),
    };
  }
}
