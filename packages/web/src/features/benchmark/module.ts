/**
 * The benchmarks list, a system app (an App Center tile, lib/system-apps.ts), and one benchmark's
 * detail, under it by path.
 */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { BenchmarkPage } from "./benchmark-page";
import { BenchmarkDetailPage } from "./benchmark-detail-page";

@Module({
  contributes: {
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
        title: "Evaluation Center",
        titleZh: "评估中心",
        icon: "trophy",
        app: { order: 50 },
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
  @Bind("benchmark.list") list = BenchmarkPage;
  @Bind("benchmark.detail") detail = BenchmarkDetailPage;
}
