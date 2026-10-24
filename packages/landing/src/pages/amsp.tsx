/**
 * AMSP on one page (/amsp): the hero with the player, the message structure as one bar chart, every
 * record and control frame, three steps to a first run, and where to read on. Its own chunk (see
 * router.tsx). The tab title and description follow the reader's language while it is open.
 */
import { S } from "../lib/strings";
import { useDocumentMeta } from "../lib/document-meta";
import { AmspHero } from "../sections/amsp/hero";
import { AmspStructure } from "../sections/amsp/structure";
import { AmspVocabulary } from "../sections/amsp/vocabulary";
import { AmspQuickstart } from "../sections/amsp/quickstart";
import { AmspLinks } from "../sections/amsp/links";

export function AmspPage() {
  useDocumentMeta(S.amsp.title, S.amsp.description);
  return (
    <>
      <AmspHero />
      <AmspStructure />
      <AmspVocabulary />
      <AmspQuickstart />
      <AmspLinks />
    </>
  );
}
