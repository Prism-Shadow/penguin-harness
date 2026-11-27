import {
  AgentAvatar,
  Button,
  ListRow,
  PageFrame,
  PageHeader,
  Pill,
  RuledSection,
  SettingsList,
  toastSuccess,
} from "@prismshadow/penguin-ui";
import { useCompanyApp } from "./context";
import { memberById } from "./model";
import type { Role } from "./model";

const ROLES: readonly Role[] = ["lead", "executor", "verifier"];

export function TeamPage() {
  const { w, org, act } = useCompanyApp();
  return (
    <PageFrame width="lg">
      <PageHeader title={w.team.title} info={w.team.info} />
      <div className="space-y-8">
        {ROLES.map((role) => {
          const members = org.members.filter((member) => member.role === role);
          return (
            <RuledSection key={role} title={w.role[role]} count={members.length}>
              <SettingsList label={w.role[role]}>
                {members.map((member) => (
                  <ListRow
                    key={member.id}
                    as="li"
                    leading={<AgentAvatar id={member.id} size={28} fallbackName={member.name} />}
                    title={member.name}
                    titleTrail={<Pill>{member.model}</Pill>}
                    description={member.duty}
                    meta={
                      <span className="flex flex-wrap gap-x-3 text-xs text-fg-muted">
                        <span>
                          {w.team.machine} {member.machine}
                        </span>
                        <span>
                          {w.team.skill}{" "}
                          {w.handbook.skillVersion(member.skill, member.skillVersion)}
                        </span>
                      </span>
                    }
                    trailing={
                      member.skillVersion > 1 ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={w.handbook.rollbackOf(member.name)}
                          onClick={() => {
                            act.rollBack(member.id);
                            toastSuccess(w.handbook.rolledBack(member.skillVersion - 1));
                          }}
                        >
                          {w.handbook.rollback}
                        </Button>
                      ) : undefined
                    }
                  />
                ))}
              </SettingsList>
            </RuledSection>
          );
        })}
      </div>
    </PageFrame>
  );
}

export function HandbookPage() {
  const { w, org } = useCompanyApp();
  const rules = org.handbook.filter((line) => line.kind === "rule");
  const lessons = org.handbook.filter((line) => line.kind === "lesson");
  return (
    <PageFrame width="lg">
      <PageHeader title={w.handbook.title} info={w.handbook.info} />
      <div className="space-y-8">
        <RuledSection title={w.handbook.rules} count={rules.length}>
          <SettingsList label={w.handbook.rules} empty={w.handbook.noRules}>
            {rules.map((line) => (
              <ListRow
                key={line.id}
                as="li"
                title={line.text}
                description={w.handbook.fromTicket(line.ticket)}
              />
            ))}
          </SettingsList>
        </RuledSection>
        <RuledSection title={w.handbook.lessons} count={lessons.length}>
          <SettingsList label={w.handbook.lessons} empty={w.handbook.noLessons}>
            {lessons.map((line) => {
              const member = line.member === undefined ? undefined : memberById(org, line.member);
              const parts = [w.handbook.fromTicket(line.ticket)];
              if (member !== undefined) {
                parts.push(member.name);
                if (line.version !== undefined)
                  parts.push(w.handbook.skillVersion(member.skill, line.version));
              }
              return (
                <ListRow key={line.id} as="li" title={line.text} description={parts.join(" · ")} />
              );
            })}
          </SettingsList>
        </RuledSection>
      </div>
    </PageFrame>
  );
}
