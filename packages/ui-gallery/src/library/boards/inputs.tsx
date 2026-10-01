/**
 * 输入与表单: Input, Textarea and PasswordInput on the shared field scaffolding, with hint, info,
 * error and in-field affixes; the search box in its three shapes; checkboxes and radio groups.
 */
import { useState } from "react";
import {
  Checkbox,
  Input,
  PasswordInput,
  RadioGroup,
  SearchInput,
  Textarea,
} from "@prismshadow/penguin-ui";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";

type ImportMode = "skip" | "overwrite" | "replace";

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
