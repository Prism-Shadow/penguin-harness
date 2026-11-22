import type { WorkbenchPackage } from "@prismshadow/penguin-server/plugin";

// Books are imported and read on the device. The page never sends book text to this handler.
export default {
  modules: {
    Workbench: {
      create() {
        return {
          api: {
            main: {
              async handle() {
                return { status: 404, body: { error: "Not found" } };
              },
            },
          },
        };
      },
    },
  },
} satisfies WorkbenchPackage;
