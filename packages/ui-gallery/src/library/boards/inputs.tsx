/**
 * 输入与表单: Input, Textarea and PasswordInput on the shared field scaffolding, with hint, info,
 * error and in-field affixes; the number input with its stepper, at a bound, closed and refused;
 * the date, time, date-and-time and date-range pickers, with a range's presets, a required, a
 * bounded, a refused and a closed date, a time on a 15-minute step and one on a 12-hour clock; the
 * search box in its three shapes; checkboxes and radio groups.
 */
import { useState } from "react";
import type { DateRangeValue } from "@prismshadow/penguin-ui";
import {
  Checkbox,
  DateField,
  DateRangeField,
  DateTimeField,
  Input,
  NumberInput,
  PasswordInput,
  RadioGroup,
  SearchInput,
  Textarea,
  TimeField,
} from "@prismshadow/penguin-ui";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";

type ImportMode = "skip" | "overwrite" | "replace";

/** A local date as the pickers write it (`YYYY-MM-DD`), read off the reader's own calendar. */
const localDate = (at: Date) =>
  `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;

/** The span of the last `days` days, today included. */
function lastDays(days: number): DateRangeValue {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
  return { from: localDate(from), to: localDate(now) };
}

/** This month's first and last days. */
function thisMonth(): { first: string; last: string } {
  const now = new Date();
  return {
    first: localDate(new Date(now.getFullYear(), now.getMonth(), 1)),
    last: localDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}

export function InputsBoard() {
  const { S } = useGallery();
  const t = S.library.inputs;
  const [name, setName] = useState("");
  const [email, setEmail] = useState(t.emailValue);
  const [prompt, setPrompt] = useState("");
  const [params, setParams] = useState(t.monoValue);
  const [password, setPassword] = useState("");
  const [context, setContext] = useState("200000");
  const [price, setPrice] = useState("15.00");
  const [replicas, setReplicas] = useState("3");
  const [retries, setRetries] = useState("5");
  const [budget, setBudget] = useState("80");
  const [date, setDate] = useState("2026-10-20");
  const [time, setTime] = useState("09:30");
  const [runAt, setRunAt] = useState("2026-10-20T09:30");
  const [span, setSpan] = useState<DateRangeValue>(() => lastDays(7));
  const [due, setDue] = useState("");
  const month = thisMonth();
  const [bounded, setBounded] = useState("");
  const [release, setRelease] = useState("2026-01-05");
  const [meeting, setMeeting] = useState("14:30");
  const [alarm, setAlarm] = useState("07:15");
  const [fieldQuery, setFieldQuery] = useState("");
  const [iconQuery, setIconQuery] = useState("");
  const [panelQuery, setPanelQuery] = useState("");
  const [menuQuery, setMenuQuery] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [plugins, setPlugins] = useState<"none" | "some" | "all">("some");
  const [mode, setMode] = useState<ImportMode>("skip");
  const modes = [
    { value: "skip", label: t.radioSkip, hint: t.radioSkipHint },
    { value: "overwrite", label: t.radioOverwrite, hint: t.radioOverwriteHint },
    { value: "replace", label: t.radioReplace, hint: t.radioReplaceHint },
  ] as const;
  const steps = { up: t.stepUp, down: t.stepDown };
  // Empty is unanswered, not wrong: only a figure outside the range is refused.
  const budgetRefused = budget.trim() !== "" && !(Number(budget) >= 1 && Number(budget) <= 50);
  return (
    <div className="gf-board">
      <BoardGroup title={t.basics}>
        <div className="lib-stack">
          <Input
            label={t.name}
            hint={t.nameHint}
            placeholder={t.namePlaceholder}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Input
            label={t.email}
            type="email"
            error={t.emailError}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Input label={t.required} required placeholder={t.required} />
          <Input
            label={t.info}
            info={t.infoText}
            infoLabel={t.info}
            id="lib-input-info"
            placeholder={t.info}
          />
        </div>
      </BoardGroup>
      <BoardGroup title={t.sizes}>
        <div className="lib-stack">
          <Input label={t.base} size="base" placeholder={t.base} />
          <Input label={t.small} size="sm" placeholder={t.small} />
        </div>
      </BoardGroup>
      <BoardGroup title={t.affix}>
        <div className="lib-stack">
          <Input
            label={t.affixContext}
            inputMode="numeric"
            className="font-mono"
            affix={{ trailing: t.affixToken }}
            value={context}
            onChange={(event) => setContext(event.target.value)}
          />
          <Input
            label={t.affixPrice}
            inputMode="decimal"
            className="text-right font-mono"
            affix={{ leading: t.affixCurrency, trailing: t.affixUnit }}
            value={price}
            onChange={(event) => setPrice(event.target.value)}
          />
        </div>
      </BoardGroup>
      <BoardGroup title={t.number}>
        <div className="lib-stack">
          <NumberInput
            label={t.numberReplicas}
            min={1}
            max={10}
            unit={t.numberPods}
            value={replicas}
            onChange={setReplicas}
            stepLabels={steps}
          />
          {/* At the top of its range: the plus has nowhere to go. */}
          <NumberInput
            label={t.numberRetries}
            min={0}
            max={5}
            value={retries}
            onChange={setRetries}
            stepLabels={steps}
          />
          <NumberInput
            label={t.numberTimeout}
            min={5}
            max={120}
            step={5}
            unit={t.numberSeconds}
            value="30"
            onChange={() => {}}
            disabled
            stepLabels={steps}
          />
          <NumberInput
            label={t.numberBudget}
            required
            min={1}
            max={50}
            unit={t.numberCurrency}
            value={budget}
            onChange={setBudget}
            error={budgetRefused ? t.numberBudgetError : undefined}
            stepLabels={steps}
          />
        </div>
      </BoardGroup>
      <BoardGroup title={t.dateTime}>
        <div className="lib-stack">
          <DateField label={t.date} value={date} onChange={setDate} />
          <TimeField label={t.time} value={time} onChange={setTime} />
          <DateTimeField label={t.dateTimeLocal} value={runAt} onChange={setRunAt} />
        </div>
      </BoardGroup>
      <BoardGroup title={t.dateRange}>
        <div className="lib-stack">
          <DateRangeField
            label={t.rangeLabel}
            required
            from={span.from}
            to={span.to}
            onChange={setSpan}
            presets={[
              { id: "7d", label: t.range7d, ...lastDays(7) },
              { id: "30d", label: t.range30d, ...lastDays(30) },
              { id: "90d", label: t.range90d, ...lastDays(90) },
            ]}
          />
        </div>
      </BoardGroup>
      <BoardGroup title={t.dateStates}>
        <div className="lib-stack">
          <DateField label={t.dateRequired} required value={due} onChange={setDue} />
          <DateField
            label={t.dateBounded}
            hint={t.dateBoundedHint}
            min={month.first}
            max={month.last}
            value={bounded}
            onChange={setBounded}
          />
          <DateField
            label={t.dateError}
            error={t.dateErrorText}
            value={release}
            onChange={setRelease}
          />
          <DateField label={t.dateDisabled} disabled value="2026-10-20" onChange={() => {}} />
          <TimeField
            label={t.timeStep}
            hint={t.timeStepHint}
            minuteStep={15}
            value={meeting}
            onChange={setMeeting}
          />
          <TimeField label={t.time12} hourCycle="h12" value={alarm} onChange={setAlarm} />
        </div>
      </BoardGroup>
      <BoardGroup title={t.textarea}>
        <div className="lib-stack">
          <Textarea
            label={t.textarea}
            placeholder={t.textareaPlaceholder}
            rows={3}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
          <Textarea
            label={t.mono}
            mono
            rows={3}
            value={params}
            onChange={(event) => setParams(event.target.value)}
          />
        </div>
      </BoardGroup>
      <BoardGroup title={t.password}>
        <div className="lib-stack">
          <PasswordInput
            label={t.password}
            hint={t.passwordHint}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
      </BoardGroup>
      <BoardGroup title={t.search}>
        <div className="lib-stack">
          <SearchInput
            value={fieldQuery}
            onChange={setFieldQuery}
            placeholder={t.searchField}
            aria-label={t.searchField}
          />
          <SearchInput
            icon
            value={iconQuery}
            onChange={setIconQuery}
            placeholder={t.searchIcon}
            aria-label={t.searchIcon}
          />
          <SearchInput
            variant="panel"
            value={panelQuery}
            onChange={setPanelQuery}
            placeholder={t.searchPanel}
            aria-label={t.searchPanel}
          />
          <SearchInput
            variant="menu"
            value={menuQuery}
            onChange={setMenuQuery}
            placeholder={t.searchMenu}
            aria-label={t.searchMenu}
          />
        </div>
      </BoardGroup>
      <BoardGroup title={t.checkboxes}>
        <div className="lib-stack">
          <Checkbox
            checked={clearKey}
            onChange={setClearKey}
            label={t.checkboxLabel}
            hint={t.checkboxHint}
          />
          {/* A summary box: some → all → none → all, the way a "select all" row cycles. */}
          <Checkbox
            checked={plugins === "all"}
            indeterminate={plugins === "some"}
            onChange={(on) => setPlugins(on ? "all" : "none")}
            label={t.checkboxAll}
          />
          <Checkbox checked disabled onChange={() => {}} label={t.checkboxDisabled} />
        </div>
      </BoardGroup>
      <BoardGroup title={t.radios}>
        <div className="lib-stack">
          <RadioGroup label={t.radioLabel} options={modes} value={mode} onChange={setMode} />
          <RadioGroup
            label={t.radioInline}
            orientation="horizontal"
            options={modes.map(({ value, label }) => ({ value, label }))}
            value={mode}
            onChange={setMode}
          />
        </div>
      </BoardGroup>
    </div>
  );
}
