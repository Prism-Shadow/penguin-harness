/**
 * The run log's "Show reasoning" switch: off leaves the agent's reasoning out of the
 * transcript, so only what it did remains. The owner keeps the value (useShowReasoning).
 */
import { useId } from "react";
import { Switch } from "../../components/ui/switch";
import { S } from "../../lib/strings";

export function ShowReasoningSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (show: boolean) => void;
}) {
  const id = useId();
  return (
    <span className="flex shrink-0 items-center gap-2">
      <label htmlFor={id} className="text-xs text-gray-500 dark:text-gray-400">
        {S.activities.runLog.showReasoning}
      </label>
      <Switch id={id} checked={checked} onChange={onChange} />
    </span>
  );
}
