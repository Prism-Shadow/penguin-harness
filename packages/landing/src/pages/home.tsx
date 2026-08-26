/** Home: one product story, ordered from promise to proof to getting started. */
import { Hero } from "../sections/hero";
import { Features } from "../sections/features";
import { SelfImprove } from "../sections/self-improve";
import { Cases } from "../sections/cases";
import { Quickstart } from "../sections/quickstart";
import { Cta } from "../sections/cta";

export function HomePage() {
  return (
    <>
      <Hero />
      <Features />
      <SelfImprove />
      <Cases />
      <Quickstart />
      <Cta />
    </>
  );
}
