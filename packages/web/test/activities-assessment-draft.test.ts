import type { ReactElement } from "react";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { AssessmentItemsEditor } from "../src/features/activities/assessment-items-editor";
import { S } from "../src/lib/strings";

// The node-only suite renders element trees; controlled edits must survive a fresh mount.
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return {
    ...react,
    useMemo: (read: () => unknown) => read(),
    useState: (initial: unknown) => [typeof initial === "function" ? initial() : initial, vi.fn()],
  };
});

function find(node: unknown, label: string): ReactElement<any> | undefined {
  if (Array.isArray(node)) return node.map((child) => find(child, label)).find(Boolean);
  if (!node || typeof node !== "object" || !("props" in node)) return;
  const element = node as ReactElement<any>;
  return element.props.label === label ? element : find(element.props.children, label);
}

describe("the assessment's shared draft", () => {
  it("keeps item edits through a fresh mount and reads JSON edits back into items", () => {
    const saved = {
      title: "test",
      items: [
        {
          interactionKey: "SIMPLE_CHOICE",
          configuration: {
            question: { text: "Original?", audio: "kept.wav" },
            simpleChoice: [
              { id: "a", value: { text: "Yes" }, isCorrect: true },
              { id: "b", value: { text: "No" }, isCorrect: false },
            ],
          },
        },
      ],
    };
    let draft: Record<string, unknown> = saved;
    const render = () =>
      AssessmentItemsEditor({
        value: draft,
        savedValue: saved,
        editable: true,
        busy: false,
        onChange: (value) => {
          draft = value;
        },
        onSave: vi.fn(),
      });
    find(render(), S.activities.assessment.question)!.props.onChange({
      target: { value: "Unsaved?" },
    });
    draft = JSON.parse(JSON.stringify(draft));
    expect(find(render(), S.activities.assessment.question)!.props.value).toBe("Unsaved?");
    (draft.items as typeof saved.items)[0]!.configuration.question.text = "From JSON?";
    expect(find(render(), S.activities.assessment.question)!.props.value).toBe("From JSON?");
    expect((draft.items as typeof saved.items)[0]!.configuration.question.audio).toBe("kept.wav");
  });

  it("wires item changes to the same text the JSON editor displays", () => {
    const source = readFileSync(
      new URL("../src/features/activities/module-document-view.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("parseDocument(text)");
    expect(source).toContain("setText(documentText(value))");
    expect(source).toContain("savedValue={document.value}");
  });
});
