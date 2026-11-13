/**
 * The company-mode spec on one page (/company): the prototype first, live, then what the spec
 * changes against the shipped mode, what the server enforces, and the ticket file field by field.
 * It specifies the next company mode; the shipped one is the docs' company-mode page. Its own
 * chunk (see router.tsx). The tab title and description follow the reader's language while it is
 * open.
 */
import { S } from "../lib/strings";
import { useDocumentMeta } from "../lib/document-meta";
import { CompanyPrototypeSection } from "../sections/company/prototype";
import { CompanyChanges } from "../sections/company/changes";
import { CompanyInvariants } from "../sections/company/invariants";
import { CompanyTicket } from "../sections/company/ticket";

export function CompanyPage() {
  useDocumentMeta(S.company.title, S.company.description);
  return (
    <>
      <CompanyPrototypeSection />
      <CompanyChanges />
      <CompanyInvariants />
      <CompanyTicket />
    </>
  );
}
