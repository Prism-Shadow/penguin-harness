/** Home: section composition, ordered to match the nav anchors. */
import { Hero } from "../sections/hero";
import { Pillars } from "../sections/pillars";
import { Compare } from "../sections/compare";
import { SelfImprove } from "../sections/self-improve";
import { Quickstart } from "../sections/quickstart";
import { Cases } from "../sections/cases";
import { Customers } from "../sections/customers";
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
      <Pillars />
      <Compare />
      <SelfImprove />
      <Quickstart />
      <Cases />
      <Customers />
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
