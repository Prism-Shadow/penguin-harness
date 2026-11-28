import { describe, expect, it } from "vitest";
import {
  Bind,
  Interface,
  Module,
  Provide,
  Use,
  type ClassCtx,
} from "@prismshadow/penguin-core/kernel";

@Interface()
export abstract class MockDrivers {
  abstract list(): string[];
}

@Interface()
export abstract class MissingService {
  abstract ping(): string;
}
import {
  bootRuntimeWebPlugins,
  isImportMapCompatible,
  type LoadedRuntimePlugin,
} from "../src/web-app/runtime-plugins";

describe("bootRuntimeWebPlugins (real @prismshadow/penguin-core/kernel)", () => {
  it("boots external web plugins through bootModules, wires cross-plugin slots, and disposes cleanly", async () => {
    const receivedDrivers: string[] = [];
    let disposed = false;

    function MockStage() {
      return null;
    }
    function MockPage() {
      return null;
    }
    function mockCreateFigure() {
      return { dispose() {} };
    }

    @Module({
      contributes: {
        "MockPetWebModule.drivers": [
          { id: "mock-driver.entry", driver: "@penguinharness/mock-driver" },
        ],
      },
    })
    class MockDriverWebModule {
      @Bind("mock-driver.entry") driver = mockCreateFigure;
    }

    @Module({
      contributes: {
        "WebAppModule.layers": [{ id: "mock-pet.layer", order: 30 }],
        "WebAppModule.pages": [
          {
            id: "mock-pet.page",
            key: "mock-pet",
            path: "/mock-pet",
            frame: "shell",
            nav: "none",
            admin: false,
            released: true,
            order: 95,
            title: "Mock Pet",
          },
        ],
      },
    })
    class MockPetWebModule {
      @Provide() drivers!: MockDrivers;
      @Bind("mock-pet.layer") layer = MockStage;
      @Bind("mock-pet.page") page = MockPage;
      setup({ contributions, effect }: ClassCtx) {
        for (const c of contributions.drivers ?? []) {
          const data = c.data as { driver?: string };
          if (typeof data.driver === "string" && typeof c.code === "function") {
            receivedDrivers.push(data.driver);
          }
        }
        this.drivers = { list: () => [...receivedDrivers] };
        effect(() => {
          disposed = true;
        });
      }
    }

    const petPlugin: LoadedRuntimePlugin = {
      specifier: "@penguinharness/mock-pet",
      namespace: { default: { modules: [MockPetWebModule] } },
      ifaces: {
        ifaces: {
          "@penguinharness/mock-pet#MockDrivers": {
            name: "MockDrivers",
            methods: { list: { params: [], returns: { data: "string[]" } } },
            slots: {
              drivers: {
                data: { driver: "string" },
                code: { fn: { params: [], returns: { data: "unknown" } } },
              },
            },
          },
        },
        types: {},
        modules: {
          MockPetWebModule: {
            name: "MockPetWebModule",
            kind: "module",
            requires: {},
            provides: { drivers: "@penguinharness/mock-pet#MockDrivers" },
            contributes: {
              "WebAppModule.layers": [{ id: "mock-pet.layer", order: 30 }],
              "WebAppModule.pages": [
                {
                  id: "mock-pet.page",
                  key: "mock-pet",
                  path: "/mock-pet",
                  frame: "shell",
                  nav: "none",
                  admin: false,
                  released: true,
                  order: 95,
                  title: "Mock Pet",
                },
              ],
            },
            children: [],
          },
        },
      },
    };

    const driverPlugin: LoadedRuntimePlugin = {
      specifier: "@penguinharness/mock-driver",
      namespace: { default: { modules: [MockDriverWebModule] } },
      ifaces: {
        ifaces: {},
        types: {},
        modules: {
          MockDriverWebModule: {
            name: "MockDriverWebModule",
            kind: "module",
            requires: {},
            provides: {},
            contributes: {
              "MockPetWebModule.drivers": [
                { id: "mock-driver.entry", driver: "@penguinharness/mock-driver" },
              ],
            },
            children: [],
          },
        },
      },
    };

    const booted = await bootRuntimeWebPlugins([petPlugin, driverPlugin]);
    expect(booted.unsatisfied).toEqual([]);
    expect(receivedDrivers).toEqual(["@penguinharness/mock-driver"]);
    expect(booted.layers.map((l) => l.id)).toEqual(["mock-pet.layer"]);
    expect(booted.layers[0]?.area).toBe("shell");
    expect(booted.pages.map((p) => p.path)).toEqual(["/mock-pet"]);

    expect(disposed).toBe(false);
    booted.dispose();
    expect(disposed).toBe(true);
  });

  it("rejects an unsatisfied plugin with missing @Use without breaking valid plugins", async () => {
    function OkLayer() {
      return null;
    }

    @Module({
      contributes: { "WebAppModule.layers": [{ id: "ok.layer", order: 10 }] },
    })
    class OkWebModule {
      @Bind("ok.layer") layer = OkLayer;
    }

    @Module()
    class BrokenWebModule {
      @Use() missing!: MissingService;
    }

    const okPlugin: LoadedRuntimePlugin = {
      specifier: "@example/ok",
      namespace: { default: { modules: [OkWebModule] } },
      ifaces: {
        ifaces: {},
        types: {},
        modules: {
          OkWebModule: {
            name: "OkWebModule",
            kind: "module",
            requires: {},
            provides: {},
            contributes: { "WebAppModule.layers": [{ id: "ok.layer", order: 10 }] },
            children: [],
          },
        },
      },
    };

    const brokenPlugin: LoadedRuntimePlugin = {
      specifier: "@example/broken",
      namespace: { default: { modules: [BrokenWebModule] } },
      ifaces: {
        ifaces: {
          "@example/broken#MissingService": {
            name: "MissingService",
            methods: { ping: { params: [], returns: { data: "string" } } },
            slots: {},
          },
        },
        types: {},
        modules: {
          BrokenWebModule: {
            name: "BrokenWebModule",
            kind: "module",
            requires: { missing: { iface: "@example/broken#MissingService" } },
            provides: {},
            contributes: {},
            children: [],
          },
        },
      },
    };

    const booted = await bootRuntimeWebPlugins([okPlugin, brokenPlugin]);
    expect(booted.unsatisfied.map((u) => u.specifier)).toEqual(["@example/broken"]);
    expect(booted.layers.map((l) => l.id)).toEqual(["ok.layer"]);
    booted.dispose();
  });
  it("guards against cross-generation hot-update importmap mismatch", () => {
    const v1 = {
      react: "/assets/shared-react-aaa.js",
      "react-dom": "/assets/shared-react-dom-111.js",
    };
    const v2 = {
      react: "/assets/shared-react-aaa.js",
      "react-dom": "/assets/shared-react-dom-222.js",
    };
    const dev = { react: "/@penguin-shared/shared-react.js" };
    expect(isImportMapCompatible(v1, v1)).toBe(true);
    expect(isImportMapCompatible(v1, v2)).toBe(false);
    expect(isImportMapCompatible(null, v2)).toBe(true);
    expect(isImportMapCompatible(dev, v2)).toBe(true);
  });
});
