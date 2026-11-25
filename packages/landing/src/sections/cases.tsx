/** The desktop Harness OS and its one-sentence A2APP App Center, at the section's full width. */
import { AppGenerationDiagram } from "../components/application-diagrams";
import { S } from "../lib/strings";
import { Section } from "../components/section";

export function Cases() {
  const c = S.cases;

  return (
    <Section id="cases" title={c.os} subtitle={c.subtitle}>
      <AppGenerationDiagram />
    </Section>
  );
}
