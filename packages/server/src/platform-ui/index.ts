/**
 * The platform UI bridge: the broker a Web App page polls, its routes, and the module that
 * provides them to the rest of the tree (the plugin commands reach the same broker).
 */
import { Module } from "@prismshadow/penguin-core/kernel";
import { PlatformUiRoutes } from "./routes.js";
import { PlatformUiService } from "./service.js";
import { PlatformUi } from "./service.js";

export { PlatformUi, PlatformUiService, UiPageBroker } from "./service.js";
export type {
  UiCommandAnswer,
  UiCommandDelivery,
  UiCommandName,
  UiCommandRequest,
  UiPageInfo,
  UiPageRegistration,
} from "./service.js";
export { PlatformUiRoutes } from "./routes.js";

@Module({
  children: [PlatformUiService, PlatformUiRoutes],
  exports: [PlatformUi],
})
export class PlatformUiModule {}
