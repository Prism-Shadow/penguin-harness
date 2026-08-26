/** Home: preserve the full product story, with the one-sentence build demo first. */
import { Hero } from "../sections/hero";
import { Cases } from "../sections/cases";
import { Pillars } from "../sections/pillars";
import { Compare } from "../sections/compare";
import { SelfImprove } from "../sections/self-improve";
import { Quickstart } from "../sections/quickstart";
import { Scenarios } from "../sections/scenarios";
import { Benchmark } from "../sections/benchmark";
import { Contract } from "../sections/contract";
import { Features } from "../sections/features";
import { Skills } from "../sections/skills";
import { Security } from "../sections/security";
import { Cta } from "../sections/cta";
import { Community } from "../sections/community";

export function HomePage() {
  return (
    <>
      <Hero />
      <Cases />
      <Pillars />
      <Compare />
      <SelfImprove />
      <Quickstart />
      <Scenarios />
      <Benchmark />
      <Contract />
      <Features />
      <Skills />
      <Security />
      <Cta />
      <Community />
    </>
  );
}
