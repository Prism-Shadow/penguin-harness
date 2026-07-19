/** Home: section composition, ordered to match the nav anchors. */
import { Hero } from "../sections/hero";
import { Pillars } from "../sections/pillars";
import { SelfImprove } from "../sections/self-improve";
import { Quickstart } from "../sections/quickstart";
import { Showcase } from "../sections/showcase";
import { Benchmark } from "../sections/benchmark";
import { Contract } from "../sections/contract";
import { Features } from "../sections/features";
import { Security } from "../sections/security";
import { Cta } from "../sections/cta";

export function HomePage() {
  return (
    <>
      <Hero />
      <Pillars />
      <SelfImprove />
      <Quickstart />
      <Showcase />
      <Benchmark />
      <Contract />
      <Features />
      <Security />
      <Cta />
    </>
  );
}
