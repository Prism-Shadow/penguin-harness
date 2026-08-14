/**
 * Hot-update MVP demo page (admin only, direct URL /hot — no sidebar entry).
 *
 * Three demos on one page, all driven by the same kernel:
 * - UI panel: code fetched from the server at runtime, hot-swapped on rev
 *   change (poll + manual activate), store state riding across via park/boot;
 * - server platform: v1→v2 (migrated) and the blocked-downgrade path;
 * - terminal: created before an upgrade, provably the same process after.
 *
 * Demo-scope shortcuts (deliberate): raw apiFetch with local types instead of
 * typed endpoints.ts entries, hardcoded English strings instead of S.*.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import * as React from "react";
import { Navigate } from "react-router";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type { Instance, Json } from "@prismshadow/penguin-core/kernel";
import { apiFetch } from "../../api/client";
import { apiErrorText } from "../../lib/api-error";
import { useDocumentTitle } from "../../lib/use-document-title";
import { useAuth } from "../../state/auth";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import type { PanelApi, PanelDeps, PanelModuleLoader } from "./panel-slot";
import { bootPanel, swapPanel } from "./panel-slot";

interface UiManifest {
  version: string;
  rev: string;
}

interface PlatformInfo {
  impl: string;
  info: Record<string, Json>;
}

type UpgradeOutcome =
  | { status: "ok"; mode: string; impl: string }
  | { status: "blocked"; dropped: string[]; missing: string[]; invalid: string[] };

const panelDeps: PanelDeps = { react: React, createStore, useStore };

const loadPanelModule: PanelModuleLoader = (rev) =>
  import(/* @vite-ignore */ `/api/hot/ui/panel.js?rev=${rev}`) as ReturnType<PanelModuleLoader>;

export function HotPage() {
  useDocumentTitle("Hot update MVP");
  const { user } = useAuth();
  const [error, setError] = useState<string | null>(null);

  // -- UI panel hot swap ----------------------------------------------------
  const [panel, setPanel] = useState<Instance<PanelApi> | null>(null);
  const [manifest, setManifest] = useState<UiManifest | null>(null);
  const panelRef = useRef<Instance<PanelApi> | null>(null);
  const swappingRef = useRef(false);

  const syncPanel = useCallback(async () => {
    try {
      const next = await apiFetch<UiManifest>("/api/hot/ui/manifest");
      setManifest(next);
      if (swappingRef.current) return;
      const current = panelRef.current;
      const currentRev = current ? (current.park().self as { rev: string }).rev : null;
      if (currentRev === next.rev) return;
      swappingRef.current = true;
      try {
        const booted = current
          ? await swapPanel(current, panelDeps, loadPanelModule, next.rev)
          : await bootPanel(panelDeps, loadPanelModule, next.rev);
        panelRef.current = booted;
        setPanel(booted);
        setError(null);
      } finally {
        swappingRef.current = false;
      }
    } catch (e) {
      setError(apiErrorText(e));
    }
  }, []);

  useEffect(() => {
    if (!user?.isAdmin) return;
    void syncPanel();
    const timer = setInterval(() => void syncPanel(), 3000);
    return () => {
      clearInterval(timer);
      panelRef.current?.dispose();
      panelRef.current = null;
    };
  }, [user?.isAdmin, syncPanel]);

  const activateUi = async (version: string) => {
    try {
      await apiFetch<UiManifest>("/api/hot/ui/activate", { method: "POST", body: { version } });
      await syncPanel();
    } catch (e) {
      setError(apiErrorText(e));
    }
  };

  // -- Server platform ------------------------------------------------------
  const [platform, setPlatform] = useState<PlatformInfo | null>(null);
  const [outcome, setOutcome] = useState<UpgradeOutcome | null>(null);

  const reloadPlatform = useCallback(async () => {
    try {
      setPlatform(await apiFetch<PlatformInfo>("/api/hot/platform"));
    } catch (e) {
      setError(apiErrorText(e));
    }
  }, []);

  useEffect(() => {
    if (user?.isAdmin) void reloadPlatform();
  }, [user?.isAdmin, reloadPlatform]);

  const upgradePlatform = async (impl: string) => {
    try {
      setOutcome(
        await apiFetch<UpgradeOutcome>("/api/hot/platform/upgrade", {
          method: "POST",
          body: { impl },
        }),
      );
    } catch (e) {
      setError(apiErrorText(e));
    }
    await reloadPlatform();
  };

  // -- Terminal survival demo ----------------------------------------------
  const [termId, setTermId] = useState<string | null>(null);
  const [termOutput, setTermOutput] = useState("");
  const [termAlive, setTermAlive] = useState<boolean | null>(null);
  const [termInput, setTermInput] = useState("");

  useEffect(() => {
    if (termId === null || !user?.isAdmin) return;
    const poll = async () => {
      try {
        const r = await apiFetch<{ output: string; alive: boolean }>(
          `/api/hot/terminals/${termId}`,
        );
        setTermOutput(r.output);
        setTermAlive(r.alive);
      } catch {
        // Poll failures (e.g. the 503 freeze window) resolve on the next tick.
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 1000);
    return () => clearInterval(timer);
  }, [termId, user?.isAdmin]);

  const createTerminal = async () => {
    try {
      const r = await apiFetch<{ id: string }>("/api/hot/terminals", {
        method: "POST",
        body: { command: "cat" },
      });
      setTermId(r.id);
    } catch (e) {
      setError(apiErrorText(e));
    }
  };

  const sendTermInput = async () => {
    if (termId === null) return;
    try {
      await apiFetch(`/api/hot/terminals/${termId}/input`, {
        method: "POST",
        body: { data: `${termInput}\n` },
      });
      setTermInput("");
    } catch (e) {
      setError(apiErrorText(e));
    }
  };

  if (user && !user.isAdmin) return <Navigate to="/chat" replace />;

  const PanelComponent = panel?.api.Component ?? null;
  const panelMeta = panel?.api.describe() ?? null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Hot update MVP</h1>
      {error !== null && <div className="text-sm text-red-600">{error}</div>}

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">UI panel (remote code, park/boot swap)</h2>
        <div className="flex items-center gap-2 text-sm">
          <span>
            active: {manifest?.version ?? "…"} rev {manifest?.rev ?? "…"}
            {panelMeta ? ` — running ${panelMeta.name} v${panelMeta.version}` : ""}
          </span>
          <Button onClick={() => void activateUi("v1")}>UI v1</Button>
          <Button onClick={() => void activateUi("v2")}>UI v2</Button>
        </div>
        {PanelComponent !== null && manifest !== null ? (
          <PanelComponent key={manifest.rev} />
        ) : (
          <div className="text-sm opacity-60">booting panel…</div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Server platform (stop-the-world park/boot)</h2>
        <div className="flex items-center gap-2">
          <Button onClick={() => void upgradePlatform("v2")}>Upgrade to v2 (migrated)</Button>
          <Button onClick={() => void upgradePlatform("v1")}>Try downgrade to v1 (blocked)</Button>
        </div>
        <pre className="overflow-auto rounded bg-black/5 p-2 text-xs">
          {JSON.stringify({ platform, lastOutcome: outcome }, null, 2)}
        </pre>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Terminal (survives platform swaps)</h2>
        {termId === null ? (
          <Button onClick={() => void createTerminal()}>Create `cat` terminal</Button>
        ) : (
          <>
            <div className="text-sm">
              {termId} — {termAlive === null ? "…" : termAlive ? "alive" : "exited"}
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={termInput}
                onChange={(e) => setTermInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void sendTermInput();
                }}
                placeholder="type, press Enter — then upgrade the platform above"
              />
              <Button onClick={() => void sendTermInput()}>Send</Button>
            </div>
            <pre className="max-h-48 overflow-auto rounded bg-black/5 p-2 text-xs">
              {termOutput}
            </pre>
          </>
        )}
      </section>
    </div>
  );
}
