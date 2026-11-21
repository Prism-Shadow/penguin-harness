/**
 * 模型: the Project's default-models dialog — the chat default, the multimodal defaults and the
 * quieter tool group, a row nothing can serve saying why and where to go — and the guide shown
 * before any model has a key, each opened from a button and closed as the app closes it. The
 * pickers are the package's model trigger; a pick here only changes the board's own state.
 */
import { useState } from "react";
import { Button, DefaultModelsDialog, ModelSelect, ModelSetupGuide } from "@prismshadow/penguin-ui";
import type { DefaultModelRow } from "@prismshadow/penguin-ui";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";

/** Model names are data: the same in both languages. */
const PICKED: Record<string, { provider: string; label: string } | undefined> = {
  chat: { provider: "deepseek", label: "DeepSeek V4.1 Flash" },
  t2t: { provider: "deepseek", label: "DeepSeek V4.1 Flash" },
  i2t: { provider: "google", label: "Gemini 4 Neon" },
  s2t: { provider: "deepseek", label: "DeepSeek ASR" },
  t2s: undefined,
  search: { provider: "deepseek", label: "DeepSeek Search" },
  fetch: undefined,
};

export function ModelsBoard() {
  const { S } = useGallery();
  const t = S.library.models;
  const [dialog, setDialog] = useState(false);
  const [guide, setGuide] = useState(false);
  const picker = (key: string, title: string) => {
    const picked = PICKED[key];
    return (
      <ModelSelect
        variant="form"
        label={picked?.label ?? t.unset}
        provider={picked?.provider ?? null}
        muted={picked === undefined}
        ariaLabel={title}
        tooltip={picked ? `${title}: ${picked.label}` : title}
        expanded={false}
        onClick={() => undefined}
      />
    );
  };
  const row = (key: string, title: string, hint?: string): DefaultModelRow => ({
    key,
    title,
    ...(hint !== undefined ? { hint } : {}),
    control: picker(key, title),
  });
  const empty = (key: string, title: string): DefaultModelRow => ({
    key,
    title,
    empty: { text: t.empty, action: { label: t.emptyAction, onClick: () => setDialog(false) } },
  });
  return (
    <div className="gf-board">
      <BoardGroup title={t.dialog} aside={t.dialogHint}>
        <div className="lib-row">
          <Button variant="primary" onClick={() => setDialog(true)}>
            {t.openDialog}
          </Button>
        </div>
        <DefaultModelsDialog
          open={dialog}
          title={t.title}
          info={t.intro}
          doneLabel={t.done}
          onClose={() => setDialog(false)}
          sections={[
            { key: "chat", title: t.chat, rows: [row("chat", t.chatModel, t.chatHint)] },
            {
              key: "multimodal",
              title: t.multimodal,
              rows: [
                row("t2t", t.t2t),
                empty("t2i", t.t2i),
                row("i2t", t.i2t),
                empty("t2v", t.t2v),
                row("s2t", t.s2t),
                row("t2s", t.t2s),
              ],
            },
            {
              key: "tools",
              title: t.tools,
              quiet: true,
              rows: [row("search", t.search), row("fetch", t.fetch)],
            },
          ]}
        />
      </BoardGroup>
      <BoardGroup title={t.guide} aside={t.guideHint}>
        <div className="lib-row">
          <Button onClick={() => setGuide(true)}>{t.openGuide}</Button>
        </div>
        <ModelSetupGuide
          open={guide}
          title={t.guideTitle}
          body={t.guideBody}
          providers={[
            {
              id: "tokendance",
              label: "TokenDance",
              description: t.tokendance,
              connectLabel: t.connect,
              onConnect: () => setGuide(false),
            },
            {
              id: "penguin-go",
              label: "Penguin Go",
              description: t.penguinGo,
              connectLabel: t.connect,
              onConnect: () => setGuide(false),
            },
          ]}
          keyText={t.keyText}
          keyAction={{ label: t.keyAction, onClick: () => setGuide(false) }}
          laterLabel={t.later}
          onClose={() => setGuide(false)}
        />
      </BoardGroup>
    </div>
  );
}
