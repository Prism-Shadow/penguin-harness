/**
 * Buttons & actions, where they occur: the Agents page toolbar (search, the create pair, an icon
 * button), a confirm dialog's footer, dense rows with their hover actions beside a code header's
 * copy button, an external link and key hints, and every button variant in every state. Static
 * stand-ins for W1's `Button`, `IconButton`, `Link`, `CopyButton`, `Kbd` and `CreateButtons`.
 */
import { fixturesFor } from "../fixtures";
import type { Fixtures } from "../fixtures";
import { defineModule, viewFor } from "../module";
import { AgentTile } from "../screens/parts";
import {
  Button,
  CodeBlock,
  GlyphIcon,
  Heading,
  IconButton,
  Kbd,
  Link,
  Modal,
  SearchInput,
} from "./parts";
import type { ButtonState, ButtonVariant } from "./parts";

function Toolbar({ f }: { f: Fixtures }) {
  const a = f.copy.agents;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Heading level={3} className="mr-auto">
          {f.copy.nav.agents}
        </Heading>
        <Button variant="secondary" leading={<GlyphIcon name="sparkle" size={13} />}>
          {a.createWithAi}
        </Button>
        <Button variant="primary" leading={<GlyphIcon name="plus" size={13} />}>
          {a.newAgent}
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <SearchInput placeholder={a.search} />
        <IconButton label={f.copy.nav.listSettings} icon="sliders" />
        <IconButton label={f.copy.common.more} icon="more" />
      </div>
      <ul className="grid grid-cols-[minmax(0,1fr)]">
        {f.agents.map((agent) => (
          <li key={agent.id} className="flex items-center gap-3 border-t border-line-muted py-2.5">
            <AgentTile id={agent.id} name={agent.name} size={24} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-(--ui-weight-medium) text-fg">
                {agent.name}
              </span>
              <span className="block truncate text-xs text-fg-muted">{agent.description}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Footer({ f }: { f: Fixtures }) {
  const a = f.copy.agents;
  // The fixture's agents are a record of two, so the reviewer is always there.
  const agent = f.agents[1]!;
  return (
    <div className="flex min-h-72 items-center justify-center">
      <Modal
        className="w-full max-w-sm"
        title={a.deleteTitle(agent.name)}
        description={a.deleteBody}
        footer={
          <>
            <Button variant="secondary" size="sm">
              {f.copy.common.cancel}
            </Button>
            <Button variant="danger" size="sm">
              {a.delete}
            </Button>
          </>
        }
      />
    </div>
  );
}

function DenseRow({ f }: { f: Fixtures }) {
  const c = f.copy.common;
  const secrets = f.vault.slice(0, 3);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <section className="grid grid-cols-[minmax(0,1fr)] gap-2">
        <div className="flex items-center gap-2">
          <Heading level={5} className="mr-auto">
            {f.copy.vault.title}
          </Heading>
          <Link external>{c.learnMore}</Link>
        </div>
        <ul className="grid grid-cols-[minmax(0,1fr)]">
          {secrets.map((secret, i) => (
            <li
              key={secret.name}
              className={`flex h-10 items-center gap-2 rounded-md px-2 ${i === 1 ? "bg-surface-muted" : ""}`}
            >
              <GlyphIcon name="key" size={14} className="text-fg-subtle" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg">
                {secret.name}
              </span>
              <span className="text-xs text-fg-muted">{secret.kind}</span>
              <span className={`flex items-center ${i === 1 ? "" : "invisible"}`}>
                <IconButton label={c.copy} icon="copy" size="sm" hovered={i === 1} />
                <IconButton label={c.edit} icon="pencil" size="sm" />
                <IconButton label={c.remove} icon="trash" size="sm" />
              </span>
            </li>
          ))}
        </ul>
      </section>
      <CodeBlock lang="bash" code={f.session.runCommand} copy={c.copy} />

      <p className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-fg-muted">
        <span className="flex items-center gap-1.5">
          <Kbd keys={["⌘", "K"]} />
          {f.copy.palette.title}
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd keys={["Esc"]} />
          {c.close}
        </span>
      </p>
    </div>
  );
}

const VARIANT_ORDER: readonly ButtonVariant[] = ["primary", "secondary", "danger", "ghost", "link"];
const STATE_ORDER: readonly ButtonState[] = ["rest", "hover", "focus", "disabled", "loading"];

/** What each variant says in the matrix: the verb it is usually given. */
function variantLabel(f: Fixtures, variant: ButtonVariant): string {
  const c = f.copy.common;
  const labels: Record<ButtonVariant, string> = {
    primary: c.save,
    secondary: c.cancel,
    danger: c.delete,
    ghost: c.skip,
    link: c.details,
  };
  return labels[variant];
}

function States({ f }: { f: Fixtures }) {
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-x-3 border-spacing-y-2 text-xs">
        <thead>
          <tr>
            <th />
            {STATE_ORDER.map((state) => (
              <th key={state} className="text-left font-mono font-(--ui-weight-body) text-fg-muted">
                {state}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {VARIANT_ORDER.map((variant) => (
            <tr key={variant}>
              <th className="pr-2 text-left font-mono font-(--ui-weight-body) text-fg-muted">
                {variant}
              </th>
              {STATE_ORDER.map((state) => (
                <td key={state}>
                  <Button variant={variant} state={state} size="xs">
                    {variantLabel(f, variant)}
                  </Button>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const VARIANTS = {
  toolbar: Toolbar,
  footer: Footer,
  "dense-row": DenseRow,
  states: States,
} as const;

export const module = defineModule({
  id: "actions",
  title: "Buttons & actions",
  description:
    "Buttons where they occur: a page toolbar, a dialog footer, a dense row's hover actions with links, keys and a copy button, and every variant in every state.",
  width: "narrow",
  variants: [
    { key: "toolbar", title: "Toolbar" },
    { key: "footer", title: "Footer" },
    { key: "dense-row", title: "Dense row" },
    { key: "states", title: "States" },
  ],
  parts: [
    "actions-button",
    "actions-icon-button",
    "actions-button-class",
    "actions-link",
    "actions-copy-button",
    "actions-close-button",
    "actions-kbd",
    "actions-hidden-file-input",
    "actions-create-buttons",
    "forms-search-input",
  ],
  render: (variant, { lang }) => {
    const View = viewFor(VARIANTS, variant);
    return <View f={fixturesFor(lang)} />;
  },
});
