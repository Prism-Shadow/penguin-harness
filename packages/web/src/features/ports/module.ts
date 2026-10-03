/** One machine's forwarded ports, admin-only like the machines page it is reached from. */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { MachinePortsPage } from "./machine-ports-page";

@Module({
  contributes: {
    "WebAppModule.pages": [
      {
        id: "ports.machine",
        key: "machine-ports",
        path: "/machines/:machineId/ports",
        frame: "shell",
        nav: "none",
        admin: true,
        released: true,
        order: 51,
      },
    ],
  },
})
export class PortsModule {
  @Bind("ports.machine") page = MachinePortsPage;
}
