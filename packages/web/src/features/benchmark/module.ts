/** The benchmarks list and one benchmark's detail. */
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
        nav: "main",
        admin: false,
        released: true,
        order: 70,
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
