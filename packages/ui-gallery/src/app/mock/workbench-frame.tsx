/** The static gallery can show the installed guide in the app list, but it has no plugin server. */
import { EmptyState, Link } from "@prismshadow/penguin-ui";
import type { ComponentProps } from "react";
import { WorkbenchFrame as InstalledWorkbenchFrame } from "../../../../web/src/features/workbenches/workbench-frame";
import { useLocale } from "../../../../web/src/state/locale";
import { SITE_URL } from "../../site/links";

const guidePreview = {
  en: {
    instruction:
      "In your installed copy of PenguinHarness, open the App Center and choose “Your first workbench”.",
    download: "Download PenguinHarness",
  },
  zh: {
    instruction: "在已安装的 PenguinHarness 中，打开应用中心，选择「我的第一个工作台」。",
    download: "下载 PenguinHarness",
  },
};

export function WorkbenchFrame(props: ComponentProps<typeof InstalledWorkbenchFrame>) {
  const { locale } = useLocale();
  if (props.tab.workbenchId !== "first-workbench-guide")
    return <InstalledWorkbenchFrame {...props} />;
  const text = guidePreview[locale];
  return (
    <div className="px-4">
      <EmptyState
        title={text.instruction}
        action={
          <Link href={`${SITE_URL}download/`} external>
            {text.download}
          </Link>
        }
      />
    </div>
  );
}
