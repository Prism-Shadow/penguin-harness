import { mainPanelDefinition as mainPaneltrace } from "./main-dock-panel";
/** Trace observation: the dock's Trace panel (trace-dock-panel.tsx). */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { TraceDockPanel } from "./trace-dock-panel";

@Module({
  contributes: {
    "DockModule.panels": [
      {
        id: "traces.panel",
        kind: "trace",
        title: "Trajectories",
        titleZh: "轨迹观测",
        icon: "eye",
        order: 40,
      },
    ],
  },
})
export class TracesModule {
  @Bind("traces.panel") panel = { mainDefinitions: [mainPaneltrace] };
}
