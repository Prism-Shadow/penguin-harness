/**
 * Projects: the Project switcher, in the sidebar's switcher row in development mode, with the
 * create and settings dialogs it opens.
 */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import type { SidebarSection } from "../../lib/sidebar-contributions";
import { ProjectSwitcher } from "./project-switcher";

@Module({
  contributes: {
    "SidebarModule.sections": [
      { id: "projects.switcher", mode: "dev", place: "header", order: 10 },
    ],
  },
})
export class ProjectsModule {
  @Bind("projects.switcher") switcher: SidebarSection = { Full: ProjectSwitcher };
}
