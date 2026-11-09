/**
 * The sidebar's Project switcher: the current Project's name as the trigger, every Project the
 * user belongs to as a radio row, then "New Project" and (with a Project open) its settings. The
 * two dialogs those rows open are mounted beside the dropdown, never inside it.
 */
import { useState } from "react";
import {
  Badge,
  Dropdown,
  ICONS,
  MenuItem,
  MenuRadioItem,
  MenuSeparator,
  SidebarSwitcherButton,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { projectDisplayName, useProject } from "../../state/project";
import { CreateProjectDialog } from "./project-dialogs/create-project-dialog";
import { ProjectSettingsDialog } from "./project-dialogs/project-settings-dialog";

export function ProjectSwitcher() {
  const { projects, currentProject, setCurrentProjectId, reloadProjects } = useProject();
  const [projectOpen, setProjectOpen] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  return (
    <>
      <Dropdown
        open={projectOpen}
        setOpen={setProjectOpen}
        className="min-w-0 flex-1"
        menuClass="left-0 right-0 top-full mt-1 origin-top"
        button={
          <SidebarSwitcherButton
            label={currentProject ? projectDisplayName(currentProject) : S.common.loading}
            onClick={() => setProjectOpen(!projectOpen)}
          />
        }
      >
        {/* Plain rows rather than a role="menu": the switcher's Project rows are named
            like its trigger, and both are reached as buttons. */}
        {projects.map((p) => (
          <MenuRadioItem
            key={p.projectId}
            label={<span className="font-sans">{projectDisplayName(p)}</span>}
            trailing={<Badge>{p.role}</Badge>}
            checked={p.projectId === currentProject?.projectId}
            onSelect={() => {
              setCurrentProjectId(p.projectId);
              setProjectOpen(false);
            }}
          />
        ))}
        <MenuSeparator />
        <MenuItem
          glyph={ICONS.plus}
          label={S.project.create}
          onSelect={() => {
            setProjectOpen(false);
            setCreateProjectOpen(true);
          }}
        />
        {currentProject && (
          <MenuItem
            glyph={ICONS.gear}
            label={S.project.settings}
            onSelect={() => {
              setProjectOpen(false);
              setProjectSettingsOpen(true);
            }}
          />
        )}
      </Dropdown>
      <CreateProjectDialog
        open={createProjectOpen}
        onClose={() => setCreateProjectOpen(false)}
        onCreated={(projectId) => {
          setCreateProjectOpen(false);
          void reloadProjects().then(() => setCurrentProjectId(projectId));
        }}
      />
      {currentProject && (
        <ProjectSettingsDialog
          open={projectSettingsOpen}
          onClose={() => setProjectSettingsOpen(false)}
        />
      )}
    </>
  );
}
