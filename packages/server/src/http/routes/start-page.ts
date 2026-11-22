/**
 * The start page's contributed counts (PRFC-0036 `StartPageModule.metrics`): a number a server
 * module fixes when its package is built — the 评估集 tile's count of upstream suites, say — with
 * its name, its glyph, its place among the others and the system app a click opens. They reach the
 * Web App as data, beside the web slots' contributions in `GET /api/contributions`
 * (`startMetrics`), and the start page draws them after its own. Nothing is read per request: a
 * count that changes is a new build of its package.
 */
import { Interface, Module, Provide } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx } from "@prismshadow/penguin-core/kernel";
import type { StartMetricContribution, StartMetricData } from "../../api/types.js";

export interface StartPageSlots {
  /** One count on the start page (StartMetricData says what each field means). */
  metrics: StartMetricData;
}

/** StartPage: the counts contributed to this App, which StartPageModule provides. */
@Interface()
export abstract class StartPage {
  /** Every contributed count, in module order, as `GET /api/contributions` sends them. */
  abstract metrics(): StartMetricContribution[];
}

@Module()
export class StartPageModule {
  @Provide() startPage!: StartPage;
  setup({ contributions }: ClassCtx) {
    // The kernel checked each contribution's data against its slot's type at boot. The
    // contribution's own fields first: `id` and `from` are the server's attribution.
    const metrics = (contributions.metrics ?? []).map(
      (c) => ({ ...c.data, id: c.id, from: c.from }) as StartMetricContribution,
    );
    this.startPage = { metrics: () => metrics };
  }
}
