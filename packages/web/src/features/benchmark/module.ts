/**
 * The Project benchmark routes, also shown by the Agent Evaluation workbench.
 */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { BenchmarkPage } from "./benchmark-page";
import { SelfEvolutionWorkbench } from "./self-evolution-workbench";
import { BenchmarkDetailPage } from "./benchmark-detail-page";

@Module({
  contributes: {
    "WebAppModule.pageRenderers": [{ id: "benchmark.workbench", name: "SelfEvolutionWorkbench" }],
    "WebAppModule.pages": [
      {
        id: "benchmark.list",
        key: "benchmark",
        path: "/benchmark",
        frame: "shell",
        nav: "none",
        admin: false,
        released: true,
        order: 70,
        title: "Self-Evolution Workbench",
        titleZh: "自进化工作台",
        icon: "trophy",
      },
      {
        id: "benchmark.detail",
        key: "benchmark-detail",
        path: "/benchmark/:benchmarkId",
        frame: "shell",
        nav: "none",
        admin: false,
        released: true,
        order: 71,
      },
    ],
  },
})
export class BenchmarkModule {
  @Bind("benchmark.workbench") workbench = SelfEvolutionWorkbench;
  @Bind("benchmark.list") list = BenchmarkPage;
  @Bind("benchmark.detail") detail = BenchmarkDetailPage;
}
