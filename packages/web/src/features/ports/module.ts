/**
 * Port forwarding on the web: the dock's Ports panel (a conversation's Workspace's forwards)
 * and a machine's Ports page (`/machines/:machineId/ports`, admin-only), where every forward
 * reaching into that machine is read and removed.
 */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { MachinePortsPage } from "./machine-ports-page";
import { mainPanelDefinition } from "./main-dock-panel";

@Module({
  contributes: {
    "WebAppModule.pages": [
      {
        id: "web.machine-ports",
        key: "machine-ports",
        path: "/machines/:machineId/ports",
        frame: "shell",
        nav: "none",
        admin: true,
        released: true,
        order: 51,
      },
    ],
    "DockModule.panels": [
      {
        id: "web.ports-panel",
        kind: "ports",
        title: "Ports",
        titleZh: "端口",
        icon: "arrowsOpposed",
        order: 80,
      },
    ],
  },
})
export class PortsModule {
  @Bind("web.machine-ports") page = MachinePortsPage;
  @Bind("web.ports-panel") panel = { mainDefinitions: [mainPanelDefinition] };
}
