/**
 * The company-mode spec on one page (/company): the hero with the inbox player, the three roles,
 * one ticket's life as a bar chart, the ticket file field by field, what the server enforces, how
 * a company is set up, and where to read on. It specifies the next company mode; the shipped one
 * is the docs' company-mode page. Its own chunk (see router.tsx). The tab title and description
 * follow the reader's language while it is open.
 */
import { S } from "../lib/strings";
import { useDocumentMeta } from "../lib/document-meta";
import { CompanyHero } from "../sections/company/hero";
import { CompanyRoles } from "../sections/company/roles";
import { CompanyLifecycle } from "../sections/company/lifecycle";
import { CompanyTicket } from "../sections/company/ticket";
import { CompanyInvariants } from "../sections/company/invariants";
import { CompanyStart } from "../sections/company/start";
import { CompanyLinks } from "../sections/company/links";

export function CompanyPage() {
  useDocumentMeta(S.company.title, S.company.description);
  return (
    <>
      <CompanyHero />
      <CompanyRoles />
      <CompanyLifecycle />
      <CompanyTicket />
      <CompanyInvariants />
      <CompanyStart />
      <CompanyLinks />
    </>
  );
}
