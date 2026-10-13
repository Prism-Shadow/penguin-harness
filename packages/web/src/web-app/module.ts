/**
 * The WebApp composition module (not a terminal command interpreter): the app's frame and its router. Features reach it only through its slots —
 * a page is a contribution to `WebAppModule.pages` with the component bound by id — so WebApp
 * imports no feature. What it provides is the root component the app mounts, with the page
 * table bound into it (web-app/deps.ts).
 *
 * The kernel addresses a slot by the providing MODULE's name (`WebAppModule.pages`), while the
 * slot declaration hangs on the interface the module provides (`WebAppSlots` beside `WebApp`) —
 * the same split as the server's `HttpModule.routes` and `HttpSlots`.
 */
import type { ComponentType } from "react";
import {
  Interface,
  Module,
  Provide,
  type ClassCtx,
  type Slot,
} from "@prismshadow/penguin-core/kernel";

import { webAppDeps } from "./deps";
import { pageTableOf, type PageData } from "./page-table";

import { AppRouter, type AppRouterProps } from "./router";

@Interface()
export abstract class WebApp {
  /** The whole routed app, everything it renders under WebApp's bindings. */
  abstract readonly Root: ComponentType<AppRouterProps>;
}

export interface WebAppSlots {
  /** A routed page; its component is the code half. */
  pages: Slot<PageData, ComponentType>;
}

@Module()
export class WebAppModule {
  @Provide() webApp!: WebApp;
  setup({ contributions }: ClassCtx) {
    const pages = pageTableOf(contributions.pages ?? []);
    this.webApp = { Root: webAppDeps.provide({ pages }, AppRouter) };
  }
}
