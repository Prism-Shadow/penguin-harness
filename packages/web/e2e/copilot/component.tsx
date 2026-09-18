import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ModelOAuthDialog } from "../../src/features/models/models-page";
import { providerInfo } from "@prismshadow/penguin-core/model-catalog";
import { setActiveStrings } from "../../src/lib/strings";
import { en } from "../../src/lib/strings-en";
import "../../src/styles.css";

setActiveStrings(en);
function Fixture() {
  const [open, setOpen] = useState(true);
  const [applied, setApplied] = useState<number | null>(null);
  return (
    <>
      {open && (
        <ModelOAuthDialog
          projectId="fixture"
          provider={providerInfo("github-copilot")!}
          count={0}
          onClose={() => setOpen(false)}
          onApplied={setApplied}
        />
      )}
      <output aria-label="Applied models">{applied}</output>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
