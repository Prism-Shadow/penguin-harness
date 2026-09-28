/**
 * One preview alone, on a real themed root — the unit the framed previews (compare mode, the
 * phone view) and `scripts/shots.mjs` render:
 *
 *   /embed?module=<module-id>&variant=<key>&theme=&mode=&tier=&lang=&accent=
 *   /embed?module=<module-id>&variant=<key>&frame=<frame-key>&play=0|1&…
 *   /embed?demo=<part-id>&variant=<key>&theme=&mode=&tier=&lang=&accent=
 *
 * An animated variant holds still, settled on its last frame, unless `frame` or `play` say
 * otherwise (see lib/live.ts); inside a section's frame (`sync=1`) it follows the clock of the
 * section around it instead, and sends the composition's own commands for that clock up to it.
 * An interactive variant renders its first state and answers the reader from there; a still is a
 * still. The root font size is the page's own: `tier=` applies to `<html>` here as on a module
 * page, so a framed preview is sized like the page's.
 *
 * A module designed at the app's width (`viewport`) lays out at exactly that width, unscaled, and
 * the root grows to hold it (`data-natural-width`), so a shot is the composition at full size; the
 * phone view drops the width, since there the 390 px frame is the viewport it answers to.
 *
 * It posts its height to a parent frame (`{ type: "gallery:height" }`) and marks
 * `<html data-gallery-ready>` once tokens are resolved and fonts have loaded, which is what the
 * screenshot script waits for. `#embed-root` carries what the script needs to walk the picks:
 * `data-kind`, `data-renderable`, `data-variants` (a module's keys), `data-kind-of-variant`,
 * `data-frames`, `data-frame` and `data-settled` (an animated variant's frame keys, the one
 * showing, and whether it is the settled last one), or `data-axes` and `data-matrix` (a demo's).
 */
import { useEffect, useRef } from "react";
import { isSettled } from "../../../ui/src/scene";
import { useFollowedClock, useScenePlayer } from "../chrome/player";
import { parseVariantKey } from "../lib/demos";
import { naturalWidth } from "../lib/fit";
import { parseEmbedCue } from "../lib/live";
import { pickVariant, variantKind } from "../lib/modules";
import { DemoView, ModuleView } from "../preview";
import { DEMOS, MODULES } from "../registry";
import { useGallery } from "../state";

export function EmbedPage() {
  const { tokens, S, state } = useGallery();
  const params = new URLSearchParams(window.location.search);
  const moduleId = params.get("module");
  const demoId = params.get("demo");
  const key = params.get("variant") ?? undefined;
  const entry = moduleId !== null ? MODULES.byId.get(moduleId) : undefined;
  const demo = moduleId === null && demoId !== null ? DEMOS.byId.get(demoId)?.demo : undefined;
  const root = useRef<HTMLDivElement>(null);

  const variant = entry ? pickVariant(entry.module, key) : undefined;
  // At its natural width and unscaled: a page scales it, but a screenshot is for pixel review.
  const natural = entry && state.view !== "phone" ? naturalWidth(entry.module) : null;
  const reduced = state.motion === "reduced";
  const sync = params.get("sync") === "1";
  // Only an animated variant runs on a clock; an interactive one drives itself, a still holds.
  const scene = variant && variantKind(variant) === "animated" ? variant.scene : undefined;
  const own = useScenePlayer(sync ? undefined : scene, {
    reduced,
    start: (frames) => parseEmbedCue(frames, window.location.search),
  });
  const followed = useFollowedClock(
    sync ? scene : undefined,
    entry?.module.id ?? "",
    variant?.key ?? "",
    reduced,
  );
  const clock = sync ? followed.clock : own.clock;
  const controls = sync ? followed.controls : own.controls;

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

  if (entry && variant) {
    return (
      <div
        ref={root}
        id="embed-root"
        className="g-preview g-embed"
        data-kind="module"
        data-module={entry.module.id}
        data-renderable="true"
        data-width={entry.module.width}
        data-natural-width={natural ?? undefined}
        data-view={state.view}
        data-variant={variant.key}
        data-variants={JSON.stringify(entry.module.variants.map((v) => v.key))}
        data-kind-of-variant={variantKind(variant)}
        data-frames={scene ? JSON.stringify(scene.frames.map((f) => f.key)) : undefined}
        data-frame={clock?.frame}
        data-settled={clock ? isSettled(clock.frames, clock) : undefined}
      >
        {natural === null ? (
          <ModuleView module={entry.module} variant={variant} clock={clock} controls={controls} />
        ) : (
          <div className="g-natural" style={{ width: natural }}>
            <ModuleView module={entry.module} variant={variant} clock={clock} controls={controls} />
          </div>
        )}
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
        data-view={state.view}
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
