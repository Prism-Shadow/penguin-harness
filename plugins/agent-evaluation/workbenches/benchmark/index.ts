import type { WorkbenchPackage } from "@prismshadow/penguin-server/plugin";

/** Benchmark requests use the existing Project routes of the evaluation service. */
export default {
  modules: {
    Workbench: {
      create() {
        return {
          api: {
            main: {
              async handle() {
                return { status: 404 };
              },
            },
          },
        };
      },
    },
  },
} satisfies WorkbenchPackage;
