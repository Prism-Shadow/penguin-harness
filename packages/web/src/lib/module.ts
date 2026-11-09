/**
 * To-dos: the owner of the update badges for the signed-in session, and the dots they put on the
 * sidebar's anchors (badges-context.tsx).
 */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import {
  UpdateBadgesProvider,
  accountBadge,
  agentsBadge,
  menuBadge,
  modelsBadge,
  pluginsBadge,
  usageBadge,
} from "./badges-context";

@Module({
  contributes: {
    "WebAppModule.sessionProviders": [{ id: "todos.badges", order: 20 }],
    "SidebarModule.navBadges": [
      { id: "todos.agents", anchor: "agents", order: 10 },
      { id: "todos.models", anchor: "models", order: 10 },
      { id: "todos.plugins", anchor: "plugins", order: 10 },
      { id: "todos.usage", anchor: "usage", order: 10 },
      { id: "todos.account", anchor: "account", order: 10 },
      { id: "todos.menu", anchor: "menu", order: 10 },
    ],
  },
})
export class TodosModule {
  @Bind("todos.badges") badges = UpdateBadgesProvider;
  @Bind("todos.agents") agents = agentsBadge;
  @Bind("todos.models") models = modelsBadge;
  @Bind("todos.plugins") plugins = pluginsBadge;
  @Bind("todos.usage") usage = usageBadge;
  @Bind("todos.account") account = accountBadge;
  @Bind("todos.menu") menu = menuBadge;
}
