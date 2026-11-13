/**
 * What a dock panel body shows while the page is still a draft and there is no conversation to
 * show it for. The bodies are contributed by their modules (features/dock/iface.ts); this is a
 * library so they can share the placeholder without importing the dock. The dock puts each body
 * under its panel's name (`DockPanelTitle`), which the placeholder wears as its title.
 */
import { createContext, useContext } from "react";
import { EmptyState } from "@prismshadow/penguin-ui";
import { S } from "./strings";

/** The display name of the panel a body is rendered as, provided by the dock around each body. */
export const DockPanelTitle = createContext("");

/** The panel's draft placeholder; `description` replaces the line most panels share. */
export function DraftPanelEmpty({ description }: { description?: string }) {
  const title = useContext(DockPanelTitle);
  return <EmptyState title={title} description={description ?? S.dock.draftEmpty} />;
}
