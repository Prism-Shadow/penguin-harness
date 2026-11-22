import { useLocation, useNavigate } from "react-router";
import { PROJECT_SETTINGS_PARAM } from "../../lib/project-settings-location";
import { useProject } from "../../state/project";
import {
  ProjectSettingsDialog,
  TAB_ICON_PATHS,
  type SettingsTab,
} from "./project-dialogs/project-settings-dialog";

export function ProjectSettingsLayer() {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentProject } = useProject();
  const params = new URLSearchParams(location.search);
  const section = params.get(PROJECT_SETTINGS_PARAM);
  if (!currentProject || !section || !Object.hasOwn(TAB_ICON_PATHS, section)) return null;
  const replaceSearch = () =>
    void navigate(
      { pathname: location.pathname, search: params.toString(), hash: location.hash },
      {
        replace: true,
        state: location.state,
        preventScrollReset: true,
      },
    );
  const select = (tab: SettingsTab) => {
    params.set(PROJECT_SETTINGS_PARAM, tab);
    replaceSearch();
  };
  const close = () => {
    if (location.state?.projectSettingsEntry) {
      void navigate(-1);
      return;
    }
    params.delete(PROJECT_SETTINGS_PARAM);
    replaceSearch();
  };
  return (
    <ProjectSettingsDialog
      key={currentProject.projectId}
      open
      initialTab={section as SettingsTab}
      onSelectTab={select}
      onClose={close}
    />
  );
}
