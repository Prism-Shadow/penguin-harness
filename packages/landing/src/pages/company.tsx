import { S } from "../lib/strings";
import { useDocumentMeta } from "../lib/document-meta";
import { CompanyHero } from "../sections/company/hero";
import { CompanyQuestions } from "../sections/company/questions";
import { CompanyPlugin } from "../sections/company/plugin";
import { CompanyTradeoffs } from "../sections/company/tradeoffs";

export function CompanyPage() {
  useDocumentMeta(S.company.title, S.company.description);
  return (
    <>
      <CompanyHero />
      <CompanyQuestions />
      <CompanyPlugin />
      <CompanyTradeoffs />
    </>
  );
}
