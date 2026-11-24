import { useState } from "react";
import { useSiteLocale } from "@prismshadow/penguin-ui/site";
import { boards } from "./examples";
import { ApplicationFigure } from "./platform-figures";
import { S } from "../../lib/strings";
import { GALLERY_URL } from "../../lib/links";
import "./proof.css";

export function AppProof() {
  const { locale } = useSiteLocale();
  const zh = locale === "zh";
  const board = boards[locale];
  const [checked, setChecked] = useState<ReadonlySet<number>>(new Set());
  const [selected, setSelected] = useState(0);
  const [open, setOpen] = useState(false);
  const titles = zh
    ? ["上线清单", "评估结果", "文档问答"]
    : ["Launch checklist", "Run scores", "Document questions"];
  const requests = zh
    ? [
        board.request,
        "把每一轮的结果放在一起，我想看到哪一题进步了。",
        "让我查到资料里和问题有关的原文。",
      ]
    : [
        board.request,
        "Put the runs side by side so I can see which case improved.",
        "Find the source passage that answers my question.",
      ];
  const pick = (next: number) => {
    setSelected(next);
    setOpen(false);
  };
  const path = selected === 1 ? "/benchmark/docs-qa-v1" : "/chat/s-hooks-index";
  return (
    <section id="cases" className="proof-section">
      <header>
        <h2>{S.cases.os}</h2>
      </header>
      <div className="proof-platform">
        <div className="proof-platform-copy">
          <span className="proof-kicker">{zh ? "一条需求" : "The request"}</span>
          <p>“{requests[selected]}”</p>
          {selected === 0 ? (
            <button
              type="button"
              className="proof-open"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              {open
                ? zh
                  ? "收起清单"
                  : "Close checklist"
                : zh
                  ? "打开上线清单"
                  : "Open launch checklist"}{" "}
              ↗
            </button>
          ) : (
            <a
              className="proof-open"
              href={GALLERY_URL + "app.html?" + new URLSearchParams({ route: path, lang: locale })}
            >
              {zh ? "打开" : "Open"} {titles[selected]} ↗
            </a>
          )}
        </div>
        <div className="proof-illustration">
          <ApplicationFigure lang={locale} selected={selected} onSelect={pick} />
        </div>
      </div>
      {open && selected === 0 && (
        <div className="proof-detail proof-sheet">
          <div className="proof-board-heading">
            <h3>{board.title}</h3>
            <span>
              {checked.size} / {board.items.length}
            </span>
          </div>
          <fieldset>
            <legend>{board.group}</legend>
            {board.items.map((name, i) => (
              <label key={i} className="proof-check">
                <input
                  type="checkbox"
                  checked={checked.has(i)}
                  onChange={() =>
                    setChecked((prev) => {
                      const next = new Set(prev);
                      if (next.has(i)) next.delete(i);
                      else next.add(i);
                      return next;
                    })
                  }
                />
                <span>{name}</span>
              </label>
            ))}
          </fieldset>
          <div className="proof-source">
            <span>
              {zh ? "工作台教程的可操作示例。" : "Working example from the First Workbench Guide."}
            </span>
            <a
              href={import.meta.env.BASE_URL + "story-proof/launch-checklist-" + locale + ".zip"}
              download
            >
              {zh ? "下载同一个工作台" : "Download this workbench"} ↓
            </a>
          </div>
        </div>
      )}
    </section>
  );
}
