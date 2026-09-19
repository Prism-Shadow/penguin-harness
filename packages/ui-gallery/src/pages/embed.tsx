/**
 * One card alone, on a real themed root — the unit the compare frames and `scripts/shots.mjs`
 * render:
 *
 *   /embed?module=<module-id>&variant=<key>&theme=&mode=&tier=&lang=
 *   /embed?demo=<part-id>&variant=<key>&theme=&mode=&tier=&lang=
 *
 * It posts its height to a parent frame (`{ type: "gallery:height" }`) and marks
 * `<html data-gallery-ready>` once tokens are resolved and fonts have loaded, which is what the
 * screenshot script waits for. `#embed-root` carries what the script needs to walk the picks:
 * `data-kind`, `data-renderable`, `data-variants` (a module's keys) or `data-axes` and
 * `data-matrix` (a demo's).
 */
import { useEffect, useRef } from "react";
import { parseVariantKey } from "../lib/demos";
import { pickVariant } from "../lib/modules";
import { DemoView, ModuleView } from "../preview";
import { DEMOS, MODULES } from "../registry";
import { useGallery } from "../state";

export function EmbedPage() {
  const { tokens, S } = useGallery();
  const params = new URLSearchParams(window.location.search);
  const moduleId = params.get("module");
  const demoId = params.get("demo");
  const key = params.get("variant") ?? undefined;
  const entry = moduleId !== null ? MODULES.byId.get(moduleId) : undefined;
  const demo = moduleId === null && demoId !== null ? DEMOS.byId.get(demoId)?.demo : undefined;
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el || window.parent === window) return;
    const post = () =>
      window.parent.postMessage(
        { type: "gallery:height", height: el.scrollHeight },
        window.location.origin,
      );
    post();
    const observer = new ResizeObserver(post);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!tokens) return;
    let live = true;
    void document.fonts.ready.then(() =>
      requestAnimationFrame(() => {
        if (live) document.documentElement.dataset.galleryReady = "1";
      }),
    );
    return () => {
      live = false;
    };
  }, [tokens]);

  if (entry) {
    const variant = pickVariant(entry.module, key);
    return (
      <div
        ref={root}
        id="embed-root"
        className="g-preview g-embed"
        data-kind="module"
        data-module={entry.module.id}
        data-renderable="true"
        data-width={entry.module.width}
        data-variant={variant.key}
        data-variants={JSON.stringify(entry.module.variants.map((v) => v.key))}
      >
        <ModuleView module={entry.module} variant={variant} />
      </div>
    );
  }
  if (demo) {
    return (
      <div
        ref={root}
        id="embed-root"
        className="g-preview g-embed"
        data-kind="demo"
        data-renderable="true"
        data-axes={JSON.stringify(demo.axes ?? {})}
        data-matrix={Boolean(demo.matrix)}
      >
        <DemoView demo={demo} pick={parseVariantKey(demo.axes, demo.matrix, key)} />
      </div>
    );
  }
  return (
    <div ref={root} id="embed-root" className="g-preview g-embed" data-renderable="false">
      <p className="g-chrome g-muted">
        {moduleId !== null
          ? S.embed.unknownModule(moduleId)
          : demoId !== null
            ? S.embed.noDemo(demoId)
            : S.embed.nothing}
      </p>
    </div>
  );
}
