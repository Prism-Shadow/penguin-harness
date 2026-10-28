/**
 * Home: one live walkthrough, the self-evolution
 * loop with its demo, the one-sentence case, what PenguinHarness is made of, what is already
 * built around the agent, the cost comparison, customer scenarios, the latest posts, how to
 * install, and the close.
 */
import { Hero } from "../sections/hero";
import { SelfImprove } from "../sections/self-improve";
import { Cases } from "../sections/cases";
import { Pillars } from "../sections/pillars";
import { Compare } from "../sections/compare";
import { Benchmark } from "../sections/benchmark";
import { Scenarios } from "../sections/scenarios";
import { Updates } from "../sections/updates";
import { Quickstart } from "../sections/quickstart";
import { Cta } from "../sections/cta";
import { Community } from "../sections/community";
import { SiteScrollTop } from "@prismshadow/penguin-ui/site";
import { S } from "../lib/strings";

export function HomePage() {
  return (
    <>
      <Hero />
      <SelfImprove />
      <Cases />
      <Pillars />
      <Compare />
      <Benchmark />
      <Scenarios />
      <Updates />
      <Quickstart />
      <Cta />
      <Community />
      <SiteScrollTop label={S.backToTop} targetId="home-top" />
    </>
  );
}
