import { useState } from "react";
import {
  Button,
  Card,
  Modal,
  PageFrame,
  PageHeader,
  Pill,
  RuledSection,
  Textarea,
} from "@prismshadow/penguin-ui";
import { useCompanyApp } from "./context";
import { money, templates } from "./fixtures";
import type { Template } from "./fixtures";

function TemplateCard({ template, onPick }: { template: Template; onPick: () => void }) {
  const { w } = useCompanyApp();
  const body = (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-medium text-fg">{template.name}</span>
        {template.otherPlugin && (
          <Pill tooltip={w.create.otherPluginHint}>{w.create.otherPlugin}</Pill>
        )}
      </span>
      <span className="mt-1 block text-xs text-fg-muted">{template.summary}</span>
      {!template.otherPlugin && (
        <span className="mt-3 block text-xs text-fg-subtle">
          {w.create.teamValue(template.executors)} · {template.workbench}
        </span>
      )}
    </>
  );
  if (template.otherPlugin)
    return (
      <Card as="li" padding="md">
        {body}
      </Card>
    );
  return (
    <Card as="li" padding="none" interactive>
      <button type="button" onClick={onPick} className="block h-full w-full p-4 text-left">
        {body}
      </button>
    </Card>
  );
}

function Fact({ name, value }: { name: string; value: string }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 py-1.5 text-sm">
      <dt className="text-fg-muted">{name}</dt>
      <dd className="min-w-0 text-fg">{value}</dd>
    </div>
  );
}

export function NewOrgPage({
  onCreate,
  back,
}: {
  onCreate: (template: Template, goal: string) => void;
  back: { label: string; onClick: () => void };
}) {
  const { w, lang } = useCompanyApp();
  const [goal, setGoal] = useState("");
  const [picked, setPicked] = useState<Template | null>(null);
  const list = templates(lang);
  const fromGoal = list[0]!;
  return (
    <PageFrame width="lg">
      <PageHeader title={w.create.title} description={w.create.description} back={back} />
      <div className="space-y-8">
        <div className="space-y-3">
          <Textarea
            size="sm"
            label={w.create.goal}
            placeholder={w.create.goalPlaceholder}
            rows={2}
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
          />
          <Button
            size="sm"
            variant="primary"
            disabled={goal.trim() === ""}
            onClick={() => setPicked(fromGoal)}
          >
            {w.create.toLead}
          </Button>
        </div>
        <RuledSection title={w.create.templates} info={w.create.templatesInfo}>
          <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-3">
            {list.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                onPick={() => setPicked(template)}
              />
            ))}
          </ul>
        </RuledSection>
      </div>
      <Modal
        open={picked !== null}
        title={picked === null ? w.create.plan : `${w.create.plan} · ${picked.name}`}
        onClose={() => setPicked(null)}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button size="sm" onClick={() => setPicked(null)}>
              {w.inbox.cancel}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                if (picked !== null) onCreate(picked, goal);
                setPicked(null);
              }}
            >
              {w.create.createOrg}
            </Button>
          </div>
        }
      >
        {picked !== null && (
          <dl className="divide-y divide-line-muted">
            <Fact name={w.create.goal} value={goal.trim() === "" ? picked.summary : goal.trim()} />
            <Fact name={w.create.planTeam} value={w.create.teamValue(picked.executors)} />
            <Fact
              name={w.create.planLimits}
              value={w.create.planLimitsValue(picked.maxRounds, money(picked.budget))}
            />
            <Fact name={w.create.planWorkbench} value={picked.workbench} />
            <Fact name={w.create.planTrigger} value={picked.trigger} />
          </dl>
        )}
      </Modal>
    </PageFrame>
  );
}
