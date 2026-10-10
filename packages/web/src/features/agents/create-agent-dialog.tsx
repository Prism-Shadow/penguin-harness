/**
 * The Agents page's "Create Agent" dialog (agents-page.tsx): name + id + description, and what
 * the new Agent starts with — plugins from the library (each one's skills and hook package), and
 * Skills from a project directory's .agents/skills or .claude/skills — through form-variant
 * dropdowns over the shared multi-select panel, with select all / select none; or, instead of
 * those, an exported snapshot package. A plain new Agent otherwise starts with none.
 *
 * A record dialog under the settings commit model: the dialog is one form, Create is live once
 * something is filled in and the id keeps the naming rule, and closing it with anything filled
 * in (Cancel, Esc, the ×, a press outside) asks before it is thrown away. The form is mounted
 * only while the dialog is open, so every opening starts empty — the spec's 「创建弹窗不留草稿」.
 * A rejection from the server lands under the id, and the dialog stays open as it was.
 */
import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import type { AgentCreateRequest, SkillMetadataItem } from "@prismshadow/penguin-server/api";
import {
  Button,
  CloseIcon,
  FieldError,
  FieldHint,
  FieldLabel,
  FormPicker,
  HiddenFileInput,
  Input,
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
import { SemanticIdField } from "../semantic-id/semantic-id-field";
import { WorkspaceSelect } from "../chat/workspace-select";
import { SkillPickList } from "../skills/skill-pick-list";
import type { PickableItem } from "../skills/skill-pick-list";
import { addSkillNames, removeSkillNames, toggleSkillName } from "../skills/skill-selection";
import {
  SNAPSHOT_ACCEPT,
  SNAPSHOT_BUTTON_CLASS,
  agentIdFromSnapshotName,
  fileToBase64,
} from "./snapshot-file";

/** The dialog's form: what Create sends, as typed and picked. */
interface CreateAgentDraft {
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
  /**
   * Snapshot package to initialize the new Agent from (null = default template). Picking one
   * hides the two seed fields: the package carries its own skills and hooks, and the server
   * rejects the combination.
   */
  snapshot: File | null;
}

const EMPTY: CreateAgentDraft = {
  name: "",
  agentId: "",
  description: "",
  plugins: [],
  skillsDir: "",
  dirSkills: [],
  snapshot: null,
};

/**
 * What Create would send, for the dirty comparison: the text trimmed, and the picked package by
 * what identifies it (two `File`s have no fields of their own to compare).
 */
const normalizeCreate = (draft: CreateAgentDraft) => ({
  ...draft,
  name: draft.name.trim(),
  agentId: draft.agentId.trim(),
  description: draft.description.trim(),
  snapshot:
    draft.snapshot === null
      ? null
      : {
          name: draft.snapshot.name,
          size: draft.snapshot.size,
          lastModified: draft.snapshot.lastModified,
        },
});

export interface CreateAgentDialogProps {
  open: boolean;
  projectId: string | null;
  /** The plugin library as picker rows; null until the page's fetch succeeds. */
  library: PickableItem[] | null;
  /** Why the library could not be read, in place of the field's hint. */
  libraryError: string | null;
  onClose: () => void;
  /** The Agent was created: the page closes the dialog and goes to it. */
  onCreated: (agentId: string) => Promise<void>;
}

export function CreateAgentDialog(props: CreateAgentDialogProps) {
  return props.open ? <CreateAgentForm {...props} /> : null;
}

function CreateAgentForm({
  projectId,
  library,
  libraryError,
  onClose,
  onCreated,
}: CreateAgentDialogProps) {
  const form = useFormDraft(EMPTY, { normalize: normalizeCreate });
  const { name, agentId, description, plugins, skillsDir, dirSkills: pickedDirSkills } = form.draft;
  const snapshotFile = form.draft.snapshot;
  /** What the server refused, under the id. Cleared by the next edit of the id. */
  const [refused, setRefused] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const requestClose = useGuardedClose(onClose, form.scope, { locked: busy });
  const [pluginsOpen, setPluginsOpen] = useState(false);
  /** The Skills the picked directory carries (null while none is picked or it is being read). */
  const [dirSkills, setDirSkills] = useState<SkillMetadataItem[] | null>(null);
  const [dirSkillsError, setDirSkillsError] = useState<string | null>(null);
  const [dirSkillsOpen, setDirSkillsOpen] = useState(false);

  const id = agentId.trim();
  const idValid = SEMANTIC_ID_PATTERN.test(id);
  // The id rule is named once something is typed into the box; an empty one has its asterisk.
  const idError = refused ?? (id !== "" && !idValid ? S.agent.idHint : undefined);

  const onPickSnapshot = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    // Seeding and the package are mutually exclusive; drop any picks made before. Suggest the id
    // from the package name (exported as <agentId>-v<n>.tar.gz) while the field is still empty;
    // the suggestion stays editable, an unusable derivation is dropped.
    const derived = agentIdFromSnapshotName(file.name);
    form.patch({
      snapshot: file,
      plugins: [],
      skillsDir: "",
      dirSkills: [],
      ...(!agentId.trim() && SEMANTIC_ID_PATTERN.test(derived) ? { agentId: derived } : {}),
    });
  };

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
      .listDirectorySkills(projectId, skillsDir)
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
  }, [projectId, skillsDir]);

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

  const create = async () => {
    if (!projectId || !form.dirty || !idValid || busy) return;
    setBusy(true);
    setRefused(undefined);
    try {
      // Name defaults to the id (leave blank to let the server fill it in from the id).
      const body: AgentCreateRequest = { agentId: id };
      if (name.trim()) body.name = name.trim();
      if (description.trim()) body.description = description.trim();
      if (snapshotFile !== null) {
        // Initialize from the picked package; seeding is mutually exclusive (the package
        // carries its own skills and hooks), and picking the file already cleared those fields.
        body.dataBase64 = await fileToBase64(snapshotFile);
      } else {
        // Picked plugins are seeded server-side inside the same create call, so a failure leaves
        // no half-equipped Agent behind.
        if (plugins.length > 0) body.plugins = plugins;
        // The pair only means anything together, so it is sent only when a directory actually
        // contributed something — picking a directory and then no Skills from it is a plain Agent.
        if (skillsDir && pickedDirSkills.length > 0) {
          body.skillsDirectory = skillsDir;
          body.directorySkills = pickedDirSkills;
        }
      }
      const res = await api.createAgent(projectId, body);
      // Created: nothing typed is unsaved any more. Forgotten now rather than when the dialog
      // unmounts, since the page navigates to the new Agent right after and the leave guard
      // would otherwise ask about a form that was just saved.
      discardUnsaved(form.scope);
      await onCreated(res.agent.agentId);
    } catch (e) {
      setRefused(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={S.agent.createTitle}
      onClose={requestClose}
      footer={
        <>
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
        {/* Optional snapshot seed: the new Agent starts from an exported package instead of
            the default template. Picking one hides the two seed fields below — the package
            carries its own skills and hooks, and the server rejects the combination. */}
        <div>
          <FieldLabel>{S.agent.createSnapshot}</FieldLabel>
          {snapshotFile === null ? (
            <label
              className={`${SNAPSHOT_BUTTON_CLASS} ${busy ? "pointer-events-none opacity-60" : ""}`}
            >
              <HiddenFileInput accept={SNAPSHOT_ACCEPT} disabled={busy} onChange={onPickSnapshot} />
              {S.agent.createSnapshotPick}
            </label>
          ) : (
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 truncate rounded-md border border-gray-300 bg-gray-50 px-2.5 py-1 font-mono text-xs dark:border-gray-700 dark:bg-gray-900">
                {snapshotFile.name}
              </span>
              <button
                type="button"
                data-tooltip={S.agent.createSnapshotClear}
                aria-label={S.agent.createSnapshotClear}
                disabled={busy}
                onClick={() => form.patch({ snapshot: null })}
                className="shrink-0 rounded-md p-1 text-gray-400 transition-colors duration-150 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <CloseIcon size={12} />
              </button>
            </div>
          )}
          <FieldHint>
            {snapshotFile === null ? S.agent.createSnapshotHint : S.agent.createSnapshotSkillsOff}
          </FieldHint>
        </div>
        {snapshotFile === null && (
          <>
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
                projectId={projectId ?? ""}
                workspace={skillsDir}
                onChange={(next) => form.patch({ skillsDir: next })}
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
          </>
        )}
      </div>
    </Modal>
  );
}
