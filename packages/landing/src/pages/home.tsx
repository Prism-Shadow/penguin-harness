/**
 * Home: the hero with the app live under it, three rows of the app at work, the one-sentence
 * case, the cost comparison, customer scenarios, the latest posts, how to install, and the close.
 */
import { Hero } from "../sections/hero";
import { Showcase } from "../sections/showcase";
import { SelfImprove } from "../sections/self-improve";
import { Cases } from "../sections/cases";
import { Benchmark } from "../sections/benchmark";
import { Scenarios } from "../sections/scenarios";
import { Updates } from "../sections/updates";
import { Quickstart } from "../sections/quickstart";
import { Cta } from "../sections/cta";
import { Community } from "../sections/community";

export function HomePage() {
  return (
    <>
      <Hero />
      <Showcase />
      <SelfImprove />
      <Cases />
      <Benchmark />
      <Scenarios />
      <Updates />
      <Quickstart />
      <Cta />
      <Community />
    </>
  );
}
