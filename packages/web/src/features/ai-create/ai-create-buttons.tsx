/**
 * The create pair in the "Create with AI" kit's words: the package's `CreateButtons`, labelled
 * "Create with AI" / "Create manually" unless the object has a verb of its own ("Import with
 * AI" / "Import manually").
 */
import { CreateButtons } from "@prismshadow/penguin-ui";
import type { CreateButtonsProps } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";

export type AiCreateButtonsProps = Omit<CreateButtonsProps, "aiLabel" | "manualLabel"> & {
  /** The AI path's label; `S.aiCreate.withAi` by default. */
  aiLabel?: string;
  /** The manual path's label; `S.aiCreate.manual` by default. */
  manualLabel?: string;
};

export function AiCreateButtons({ aiLabel, manualLabel, ...rest }: AiCreateButtonsProps) {
  return (
    <CreateButtons
      {...rest}
      aiLabel={aiLabel ?? S.aiCreate.withAi}
      manualLabel={manualLabel ?? S.aiCreate.manual}
    />
  );
}
