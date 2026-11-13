/**
 * The Agents page's "Create Agent" dialog (agents-page.tsx): name + id + description, and what
 * the new Agent starts with — plugins from the library (each one's skills, hook package and MCP
 * servers), and Skills from a project directory's .agents/skills or .claude/skills — through
 * form-variant dropdowns over the shared multi-select panel, with select all / select none. A
 * plain new Agent otherwise starts with none; one from an exported file is the page's "Import
 * agent", which the footer points to.
 * A picked plugin with a stdio MCP server asks before the Agent is created, showing the command
 * it runs on this server.
 *
 * A record dialog under the settings commit model: the dialog is one form, Create is live once
 * something is filled in and the id keeps the naming rule, and closing it with anything filled
 * in (Cancel, Esc, the ×, a press outside) asks before it is thrown away. The form is mounted
 * only while the dialog is open, so every opening starts empty — the spec's 「创建弹窗不留草稿」.
 * A rejection from the server lands under the id, and the dialog stays open as it was.
 *
 * Where a machine is connected, the first field is where the Agent is created: this server, or
 * that machine — where it then lives (lib/agent-location.ts). On a machine the whole create runs
 * there: the plugins on offer are that machine's library, the Skills directory is browsed on it,
 * and it decides whether the id is free. A new location drops the plugins
 * and the directory picked for the old one, which would name things the new one may not have.
 */
import { useEffect, useState } from "react";

import type {
  AgentCreateRequest,
  PluginItem,
  SkillMetadataItem,
} from "@prismshadow/penguin-server/api";
import {
  Button,
  ConfirmModal,
  FieldError,
  FieldHint,
  FieldLabel,
  FormPicker,
  ICONS,
  InfoPopover,
  Input,
  MenuSelectBody,
  Modal,
  Textarea,
  discardUnsaved,
  useFormDraft,
  useGuardedClose,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { SEMANTIC_ID_PATTERN } from "../../lib/semantic-id";
import { SemanticIdField } from "../semantic-id";
import { WorkspaceSelect } from "../workspace";
import {
  SkillPickList,
  addSkillNames,
  removeSkillNames,
  toggleSkillName,
  type PickableItem,
} from "../skills";

import { StdioDisclosure, stdioServers } from "../plugins";

/** A library plugin as a picker row, keeping what the create confirmation reads: its title and its MCP servers. */
export type PluginPickItem = PickableItem & Pick<PluginItem, "title" | "titleZh" | "mcpServers">;

/**
 * The library's plugins as picker rows. A row is a Skill's metadata, which a plugin's manifest
 * already carries (name, descriptions, icon, version); a plugin without an icon draws the puzzle
 * piece rather than the book.
 */
export function pluginPickItems(plugins: readonly PluginItem[]): PluginPickItem[] {
  return plugins.map((plugin) => ({ ...plugin, fallbackIcon: ICONS.puzzle }));
}

/** The location picker's value for this server: a machine id is never empty. */
const HERE = "";

/** A connected machine the Agent can be created on: its id, and its SSH alias to show. */
export interface LocationChoice {
  value: string;
  label: string;
}

/** The dialog's form: what Create sends, as typed and picked. */
interface CreateAgentDraft {
  /** The machine the Agent is created on; null for this server. */
  location: string | null;
  name: string;
  agentId: string;
  description: string;
  /** Library plugins to install into the new Agent, in pick order. */
  plugins: string[];
  /**
   * The project directory Skills are imported from, kept apart from the library picks: the
   * server lets a directory Skill and a library plugin's Skill share a name (the directory one
   * wins), which one flat list of picked names could not express.
   */
  skillsDir: string;
  /** The Skills picked from that directory. */
  dirSkills: string[];
}

const EMPTY: CreateAgentDraft = {
  location: null,
  name: "",
  agentId: "",
  description: "",
  plugins: [],
  skillsDir: "",
  dirSkills: [],
};

/** What Create would send, for the dirty comparison: the text trimmed. */
const normalizeCreate = (draft: CreateAgentDraft) => ({
  ...draft,
  name: draft.name.trim(),
  agentId: draft.agentId.trim(),
  description: draft.description.trim(),
});

export interface CreateAgentDialogProps {
  open: boolean;
  projectId: string | null;
  /** This server's plugin library as picker rows; null until the page's fetch succeeds. */
  library: PluginPickItem[] | null;
  /** Why the library could not be read, in place of the field's hint. */
  libraryError: string | null;
  /** The connected machines an Agent can be created on; empty (the field hidden) when none is. */
  machines?: readonly LocationChoice[];
  onClose: () => void;
  /** The footer's way to "Import agent": the page closes this dialog and opens that one. */
  onImport?: () => void;
  /** The Agent was created on `machineId` (null: this server): the page closes the dialog and goes to it. */
  onCreated: (agentId: string, machineId: string | null) => Promise<void>;
}

export function CreateAgentDialog(props: CreateAgentDialogProps) {
  return props.open ? <CreateAgentForm {...props} /> : null;
}

function CreateAgentForm({
  projectId,
  library: libraryHere,
  libraryError: libraryErrorHere,
  machines = [],
  onClose,
  onImport,
  onCreated,
}: CreateAgentDialogProps) {
  const form = useFormDraft(EMPTY, { normalize: normalizeCreate });
  const {
    location,
    name,
    agentId,
    description,
    plugins,
    skillsDir,
    dirSkills: pickedDirSkills,
  } = form.draft;
  /** A machine's own library, read when it is picked: the plugins it would install from. */
  const [machineLibrary, setMachineLibrary] = useState<{
    machineId: string;
    items: PluginPickItem[] | null;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    if (location === null) return;
    let cancelled = false;
    setMachineLibrary({ machineId: location, items: null, error: null });
    api.getPluginLibrary(location).then(
      (res) => {
        if (cancelled) return;
        const items = pluginPickItems(res.groups.flatMap((g) => g.plugins));
        setMachineLibrary({ machineId: location, items, error: null });
      },
      (e: unknown) => {
        if (!cancelled)
          setMachineLibrary({ machineId: location, items: null, error: apiErrorText(e) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [location]);
  const onMachine =
    location === null ? null : machineLibrary?.machineId === location ? machineLibrary : null;
  /** The library the picked location installs from, and why it could not be read. */
  const library = location === null ? libraryHere : (onMachine?.items ?? null);
  const libraryError = location === null ? libraryErrorHere : (onMachine?.error ?? null);
  /** The picked machine's name, for the words that say where a command runs. */
  const machineLabel =
    location === null ? undefined : machines.find((m) => m.value === location)?.label;
  /** What the server refused, under the id. Cleared by the next edit of the id. */
  const [refused, setRefused] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const requestClose = useGuardedClose(onClose, form.scope, { locked: busy });
  /** Over to the import dialog: what was filled in here goes nowhere with it, so it asks first. */
  const requestImport = useGuardedClose(onImport ?? onClose, form.scope, { locked: busy });
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  /** The Skills the picked directory carries (null while none is picked or it is being read). */
  const [dirSkills, setDirSkills] = useState<SkillMetadataItem[] | null>(null);
  const [dirSkillsError, setDirSkillsError] = useState<string | null>(null);
  const [dirSkillsOpen, setDirSkillsOpen] = useState(false);
  /** Creating waits on the confirmation a picked plugin's stdio MCP server asks for: the command it runs on this server. */
  const [stdioConfirmOpen, setStdioConfirmOpen] = useState(false);

  const id = agentId.trim();
  const idValid = SEMANTIC_ID_PATTERN.test(id);
  // The id rule is named once something is typed into the box; an empty one has its asterisk.
  const idError = refused ?? (id !== "" && !idValid ? S.agent.idHint : undefined);

  // Re-read whenever the picked directory changes. A directory that carries no Skills answers with
  // an empty list, which the field states in place of its hint rather than treating as a failure.
  useEffect(() => {
    if (!skillsDir || !projectId) {
      setDirSkills(null);
      setDirSkillsError(null);
      return;
    }
    let cancelled = false;
    // The previous directory's Skills go first: keeping them would leave their rows on offer and
    // their picked names submittable against the newly picked directory.
    setDirSkills(null);
    setDirSkillsError(null);
    api
      .listDirectorySkills(projectId, skillsDir, location)
      .then((res) => {
        if (!cancelled) setDirSkills(res.skills);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setDirSkills(null);
        setDirSkillsError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, skillsDir, location]);

  // Picked names are dropped when they are no longer on offer, so switching directories cannot
  // submit a name the new one does not carry.
  const { setDraft } = form;
  useEffect(() => {
    setDraft((d) => {
      if (d.dirSkills.length === 0) return d;
      if (dirSkills === null) return { ...d, dirSkills: [] };
      const available = new Set(dirSkills.map((skill) => skill.name));
      const next = d.dirSkills.filter((n) => available.has(n));
      return next.length === d.dirSkills.length ? d : { ...d, dirSkills: next };
    });
  }, [dirSkills, setDraft]);

  /** The picked seed plugins that carry a stdio MCP server: creating the Agent runs their commands on this server. */
  const stdioSeeds = (library ?? []).filter(
    (plugin) => plugins.includes(plugin.name) && stdioServers(plugin).length > 0,
  );

  /** `confirmed`: the stdio confirmation was answered, or nothing picked asks for one. */
  const create = async (confirmed = false) => {
    if (!projectId || !form.dirty || !idValid || busy) return;
    // A seed plugin with a stdio server runs a command on this server whenever a session of the
    // new Agent starts — said, and confirmed, before anything is created, as installing it later
    // from the Plugins page would ask.
    if (!confirmed && stdioSeeds.length > 0) {
      setStdioConfirmOpen(true);
      return;
    }
    setBusy(true);
    setRefused(undefined);
    try {
      // Name defaults to the id (leave blank to let the server fill it in from the id). A person
      // fills this dialog, so the new Agent's author is `user`.
      const body: AgentCreateRequest = { agentId: id, author: "user" };
      if (name.trim()) body.name = name.trim();
      if (description.trim()) body.description = description.trim();
      // Picked plugins are seeded server-side inside the same create call, so a failure leaves
      // no half-equipped Agent behind.
      if (plugins.length > 0) body.plugins = plugins;
      // The pair only means anything together, so it is sent only when a directory actually
      // contributed something — picking a directory and then no Skills from it is a plain Agent.
      if (skillsDir && pickedDirSkills.length > 0) {
        body.skillsDirectory = skillsDir;
        body.directorySkills = pickedDirSkills;
      }
      const res = await api.createAgent(projectId, body, location);
      // Created: nothing typed is unsaved any more. Forgotten now rather than when the dialog
      // unmounts, since the page navigates to the new Agent right after and the leave guard
      // would otherwise ask about a form that was just saved.
      discardUnsaved(form.scope);
      await onCreated(res.agent.agentId, location);
    } catch (e) {
      setRefused(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        open
        title={S.agent.createTitle}
        onClose={requestClose}
        footer={
          <>
            {onImport !== undefined && (
              <p className="mr-auto flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">
                <span>{S.agent.createFromFileHint}</span>
                <Button size="sm" variant="link" onClick={requestImport}>
                  {S.agent.importAgent}
                </Button>
              </p>
            )}
            <Button size="sm" onClick={requestClose}>
              {S.common.cancel}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!form.dirty || !idValid || busy}
              onClick={() => void create()}
            >
              {S.common.create}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {/* Where the Agent is created, first: everything below is read from that server. Only
            once there is a machine to pick. */}
          {machines.length > 0 && (
            <div>
              <div className="mb-1 flex items-center gap-1">
                <FieldLabel block={false}>{S.agent.createLocation}</FieldLabel>
                <InfoPopover label={S.agent.createLocation}>
                  {S.agent.createLocationInfo}
                </InfoPopover>
              </div>
              {/* The dialog's own dropdown, as wide as the Plugins field's, over a one-choice menu. */}
              <FormPicker
                size="sm"
                open={locationOpen}
                setOpen={setLocationOpen}
                label={location === null ? S.agent.createLocationHere : (machineLabel ?? location)}
                ariaLabel={S.agent.createLocation}
                disabled={busy}
                menuClass="w-[26rem]"
              >
                <MenuSelectBody
                  options={[{ value: HERE, label: S.agent.createLocationHere }, ...machines]}
                  value={location ?? HERE}
                  onPick={(next) => {
                    setLocationOpen(false);
                    if (next === (location ?? HERE)) return;
                    form.patch({
                      location: next === HERE ? null : next,
                      plugins: [],
                      skillsDir: "",
                      dirSkills: [],
                    });
                  }}
                />
              </FormPicker>
            </div>
          )}
          {/* The name comes first and the id is derived from it: an id is the harder half to
            invent, and naming the Agent is where anyone starts anyway. */}
          <Input
            label={S.common.name}
            size="sm"
            value={name}
            onChange={(e) => form.patch({ name: e.target.value })}
            hint={S.agent.nameHint}
            autoFocus
          />
          <SemanticIdField
            projectId={projectId}
            kind="agent"
            label={S.agent.id}
            hint={S.agent.idHint}
            generateHint={S.agent.idGenerateHint}
            value={agentId}
            source={name.trim() || description}
            error={idError}
            disabled={busy}
            onChange={(next) => {
              form.patch({ agentId: next });
              setRefused(undefined);
            }}
          />
          <Textarea
            label={S.agent.description}
            size="sm"
            rows={3}
            value={description}
            onChange={(e) => form.patch({ description: e.target.value })}
          />
          {/* Seed plugins: the form-variant picker (same trigger as the schedule dialog's
          model and workspace pickers) over the shared multi-select panel, so a dialog field
          and the composer's dropdown offer one list with one set of row semantics. */}
          <div>
            <FieldLabel>{S.agent.createPlugins}</FieldLabel>
            <FormPicker
              size="sm"
              open={pluginsOpen}
              setOpen={setPluginsOpen}
              label={
                plugins.length === 0
                  ? S.agent.createPluginsPlaceholder
                  : S.agent.createPluginsPicked(plugins.length)
              }
              muted={plugins.length === 0}
              ariaLabel={S.agent.createPlugins}
              disabled={busy}
              menuClass="w-[26rem]"
            >
              <SkillPickList
                skills={library ?? []}
                selected={plugins}
                onToggle={(pluginName) =>
                  setDraft((d) => ({ ...d, plugins: toggleSkillName(d.plugins, pluginName) }))
                }
                onSelectAll={(names) =>
                  setDraft((d) => ({ ...d, plugins: addSkillNames(d.plugins, names) }))
                }
                onSelectNone={(names) =>
                  setDraft((d) => ({ ...d, plugins: removeSkillNames(d.plugins, names) }))
                }
                emptyHint={library === null ? S.common.loading : S.agent.createPluginsEmpty}
                searchPlaceholder={S.plugins.searchPlaceholder}
              />
            </FormPicker>
            {libraryError ? (
              <FieldError>{libraryError}</FieldError>
            ) : (
              <FieldHint>{S.agent.createPluginsHint}</FieldHint>
            )}
          </div>
          {/* Skills a checkout already carries: pick the project directory, then pick from what
          its .agents/skills / .claude/skills hold. Separate from the library field because a
          directory Skill may share a library plugin's Skill name and still be the one installed. */}
          <div>
            <FieldLabel>{S.agent.createDirSkills}</FieldLabel>
            <WorkspaceSelect
              // Keyed by the location: a picker browsing one server is not reused for another.
              key={location ?? HERE}
              projectId={projectId ?? ""}
              workspace={skillsDir}
              onChange={(next) => form.patch({ skillsDir: next })}
              machineId={location}
              chooseMachine={false}
              variant="form"
              fieldLabel={S.agent.createDirSkills}
              emptyLabel={S.agent.createDirSkillsPick}
              clearLabel={S.agent.createDirSkillsClear}
            />
            {skillsDir && dirSkills !== null && dirSkills.length > 0 && (
              <div className="mt-2">
                <FormPicker
                  size="sm"
                  open={dirSkillsOpen}
                  setOpen={setDirSkillsOpen}
                  label={
                    pickedDirSkills.length === 0
                      ? S.agent.createSkillsPlaceholder
                      : S.agent.createSkillsPicked(pickedDirSkills.length)
                  }
                  muted={pickedDirSkills.length === 0}
                  ariaLabel={S.agent.createDirSkills}
                  disabled={busy}
                  menuClass="w-[26rem]"
                >
                  <SkillPickList
                    skills={dirSkills}
                    selected={pickedDirSkills}
                    onToggle={(skillName) =>
                      setDraft((d) => ({
                        ...d,
                        dirSkills: toggleSkillName(d.dirSkills, skillName),
                      }))
                    }
                    onSelectAll={(names) =>
                      setDraft((d) => ({ ...d, dirSkills: addSkillNames(d.dirSkills, names) }))
                    }
                    onSelectNone={(names) =>
                      setDraft((d) => ({
                        ...d,
                        dirSkills: removeSkillNames(d.dirSkills, names),
                      }))
                    }
                    emptyHint={S.agent.createDirSkillsEmpty}
                  />
                </FormPicker>
              </div>
            )}
            {dirSkillsError ? (
              <FieldError>{dirSkillsError}</FieldError>
            ) : (
              <FieldHint>
                {!skillsDir
                  ? S.agent.createDirSkillsHint
                  : dirSkills === null
                    ? S.common.loading
                    : dirSkills.length === 0
                      ? S.agent.createDirSkillsEmpty
                      : S.agent.createDirSkillsFound(dirSkills.length)}
              </FieldHint>
            )}
          </div>
        </div>
      </Modal>
      {/* A picked plugin with a stdio MCP server: the command it runs on this server, before the
          Agent exists. The compact card has no title bar, so the body asks. */}
      {stdioConfirmOpen && (
        <ConfirmModal
          open
          title={S.agent.createStdioQuestion(name.trim() || id)}
          tone="primary"
          glyph={ICONS.terminalPrompt}
          confirmLabel={S.common.create}
          cancelLabel={S.common.cancel}
          onClose={() => setStdioConfirmOpen(false)}
          onConfirm={() => {
            setStdioConfirmOpen(false);
            void create(true);
          }}
        >
          <div className="space-y-3">
            <p className="text-sm font-medium">{S.agent.createStdioQuestion(name.trim() || id)}</p>
            <StdioDisclosure plugins={stdioSeeds} machine={machineLabel} />
          </div>
        </ConfirmModal>
      )}
    </>
  );
}
