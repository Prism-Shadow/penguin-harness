/**
 * The Screens module: the four full-viewport composites (`packages/ui/src/screens`) as scaled
 * thumbnails, each linking to its `/screens/<name>` page. It lives in the gallery because a
 * thumbnail is a frame of the gallery's own route: the screens fill `100vh`, which only a frame of a
 * desktop viewport gives them.
 */
import { useEffect, useRef, useState } from "react";
import { defineModule } from "../../../ui/src/module";
import { ChromeIcon } from "../chrome/icons";
import { BASE } from "../lib/location";
import { formatGalleryQuery } from "../lib/url-state";
import { SCREENS } from "../screens";
import { useGallery } from "../state";

/** The desktop viewport a thumbnail lays the screen out at, before scaling it to the card. */
const VIEWPORT = { width: 1440, height: 900 };

function Thumbnail({ id }: { id: string }) {
  const { S, state } = useGallery();
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setScale(el.clientWidth / VIEWPORT.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const screen = SCREENS[id];
  if (!screen) return <p className="g-chrome g-muted">{S.screens.notFound(id)}</p>;
  const query = formatGalleryQuery({ ...state, compare: false, variants: {} });
  const href = `${BASE}/screens/${id}${query}`;
  return (
    <div className="g-screen g-chrome">
      <div ref={box} className="g-screen-thumb">
        <iframe
          title={screen.title}
          src={`${href}&bare=1`}
          tabIndex={-1}
          style={{ ...VIEWPORT, transform: `scale(${scale})` }}
        />
      </div>
      <div className="g-screen-foot">
        <span className="g-muted">{S.screens.descriptions[id] ?? screen.description}</span>
        <a className="g-button" href={href}>
          <ChromeIcon name="external" size={14} />
          {S.screens.open}
        </a>
      </div>
    </div>
  );
}

export const module = defineModule({
  id: "screens",
  title: "Screens",
  description:
    "The four full-viewport composites the modules add up to, each opening at full size on its own page.",
  width: "wide",
  variants: [
    { key: "chat", title: "Chat" },
    { key: "traces", title: "Traces" },
    { key: "settings", title: "Settings" },
    { key: "login", title: "Login" },
  ],
  parts: [],
  render: (variant) => <Thumbnail id={variant} />,
});
