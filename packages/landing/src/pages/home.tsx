/** Home: section composition, ordered to match the nav anchors. */
import { Hero } from "../sections/hero";
import { Why } from "../sections/why";
import { Quickstart } from "../sections/quickstart";
import { Contract } from "../sections/contract";
import { Features } from "../sections/features";
import { Security } from "../sections/security";
import { Cta } from "../sections/cta";

export function HomePage() {
  return (
    <>
      <Hero />
      <Why />
      <Quickstart />
      <Contract />
      <Features />
      <Security />
      <Cta />
    </>
  );
}
