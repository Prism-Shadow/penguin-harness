/**
 * The company-mode spec on one page (/company): the prototype first, live, with what to try in
 * setting up and day to day; then the organization in one picture, what is borrowed from which
 * product, where it stops, the two problems it answers, what the server enforces, and the ticket
 * file field by field.
 * It specifies the next company mode; the shipped one is the docs' company-mode page. Its own
 * chunk (see router.tsx). The tab title and description follow the reader's language while it is
 * open.
 */
import { S } from "../lib/strings";
import { useDocumentMeta } from "../lib/document-meta";
import { CompanyArchitecture } from "../sections/company/architecture";
import { CompanyBorrow } from "../sections/company/borrow";
import { CompanyInvariants } from "../sections/company/invariants";
import { CompanyProblems } from "../sections/company/problems";
import { CompanyPrototypeSection } from "../sections/company/prototype";
import { CompanyScope } from "../sections/company/scope";
import { CompanyTicket } from "../sections/company/ticket";

export function CompanyPage() {
  useDocumentMeta(S.company.title, S.company.description);
  return (
    <>
      <CompanyPrototypeSection />
      <CompanyArchitecture />
      <CompanyBorrow />
      <CompanyScope />
      <CompanyProblems />
      <CompanyInvariants />
      <CompanyTicket />
    </>
  );
}
