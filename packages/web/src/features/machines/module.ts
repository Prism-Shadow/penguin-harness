/** The machines page, admin-only: it installs onto other hosts with the server account's ssh keys. */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { MachinesPage } from "./machines-page";

@Module({
  contributes: {
    "WebAppModule.pages": [
      {
        id: "machines.page",
        key: "machines",
        path: "/machines",
        frame: "shell",
        nav: "main",
        admin: true,
        released: true,
        order: 50,
      },
    ],
  },
})
export class MachinesModule {
  @Bind("machines.page") page = MachinesPage;
}
