/** The desktop Agent OS and its one-sentence A2APP app center. */
import { AppGenerationDiagram } from "../components/application-diagrams";
import { S } from "../lib/strings";
import { Section } from "../components/section";

export function Cases() {
  const c = S.cases;

  return (
    <Section id="cases" title={c.os} subtitle={c.subtitle}>
      <div className="mx-auto max-w-5xl">
        <AppGenerationDiagram />
      </div>
    </Section>
  );
}
