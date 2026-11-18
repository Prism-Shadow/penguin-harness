import { useLocation, useNavigate } from "react-router";

export const PROJECT_SETTINGS_PARAM = "projectSettings";

/** Keep the underlying page and its filters in history so closing settings returns to the same view. */
export function useOpenProjectSettings() {
  const location = useLocation();
  const navigate = useNavigate();
  return (section: "general" | "multimodal") => {
    const params = new URLSearchParams(location.search);
    params.set(PROJECT_SETTINGS_PARAM, section);
    void navigate(
      { pathname: location.pathname, search: params.toString(), hash: location.hash },
      {
        state: { ...location.state, projectSettingsEntry: true },
        preventScrollReset: true,
      },
    );
  };
}
