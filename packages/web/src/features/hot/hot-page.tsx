/**
 * Hot-update MVP demo page (admin only, direct URL /hot — no sidebar entry).
 *
 * Three demos on one page, all driven by the same kernel:
 * - UI panel: code fetched from the server at runtime, hot-swapped strictly
 *   on request (activate / check-for-updates buttons — nothing auto-triggers
 *   a reload), store state riding across via park/boot;
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

  // Initial boot only — reloads are strictly request-driven (the buttons below).
  useEffect(() => {
    if (!user?.isAdmin) return;
    void syncPanel();
    return () => {
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

  // -- Skills: one-sentence authoring ---------------------------------------
  const [skills, setSkills] = useState<{ id: string; skill: { name: string } }[]>([]);
  const [tools, setTools] = useState<{ name: string; description: string; owner: string }[]>([]);
  const [authorRequest, setAuthorRequest] = useState("");
  const [authoring, setAuthoring] = useState(false);
  const [authorNote, setAuthorNote] = useState<string | null>(null);
  const [invokeName, setInvokeName] = useState("");
  const [invokeInput, setInvokeInput] = useState("{}");
  const [invokeResult, setInvokeResult] = useState<string | null>(null);

  const reloadSkills = useCallback(async () => {
    try {
      setSkills((await apiFetch<{ skills: typeof skills }>("/api/hot/skills")).skills);
      setTools((await apiFetch<{ tools: typeof tools }>("/api/hot/tools")).tools);
    } catch (e) {
      setError(apiErrorText(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (user?.isAdmin) void reloadSkills();
  }, [user?.isAdmin, reloadSkills]);

  const authorSkill = async () => {
    const request = authorRequest.trim();
    if (request === "" || authoring) return;
    setAuthoring(true);
    setAuthorNote(null);
    try {
      const r = await apiFetch<{ id: string; attempts: number; tools: { name: string }[] }>(
        "/api/hot/skills/author",
        { method: "POST", body: { request } },
      );
      setAuthorNote(
        `installed '${r.id}' in ${r.attempts} attempt(s) — tools: ${r.tools.map((t) => t.name).join(", ")}`,
      );
      setAuthorRequest("");
      await reloadSkills();
    } catch (e) {
      setAuthorNote(apiErrorText(e));
    } finally {
      setAuthoring(false);
    }
  };

  const invokeTool = async () => {
    try {
      const input = invokeInput.trim() === "" ? null : (JSON.parse(invokeInput) as unknown);
      const r = await apiFetch<{ result: unknown }>(
        `/api/hot/tools/${encodeURIComponent(invokeName)}/invoke`,
        { method: "POST", body: { input } },
      );
      setInvokeResult(JSON.stringify(r.result));
    } catch (e) {
      setInvokeResult(
        e instanceof SyntaxError ? `input is not JSON: ${e.message}` : apiErrorText(e),
      );
    }
  };

  const removeSkill = async (id: string) => {
    try {
      await apiFetch(`/api/hot/skills/${encodeURIComponent(id)}`, { method: "DELETE" });
      await reloadSkills();
    } catch (e) {
      setError(apiErrorText(e));
    }
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
        // Transient poll failures resolve on the next tick (upgrade windows
        // only add latency: requests are enqueued server-side, not rejected).
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
          <Button onClick={() => void syncPanel()}>Check for updates</Button>
        </div>
        {PanelComponent !== null && manifest !== null ? (
          <PanelComponent key={manifest.rev} />
        ) : (
          <div className="text-sm opacity-60">booting panel…</div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Skills — describe it, get a tool</h2>
        <div className="flex items-center gap-2">
          <Input
            value={authorRequest}
            onChange={(e) => setAuthorRequest(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void authorSkill();
            }}
            placeholder='e.g. 实现计数器功能 / "a tool converting numbers to Roman numerals"'
          />
          <Button onClick={() => void authorSkill()} disabled={authoring}>
            {authoring ? "authoring…" : "Implement"}
          </Button>
        </div>
        {authorNote !== null && <div className="text-sm">{authorNote}</div>}
        {skills.length > 0 && (
          <ul className="text-sm">
            {skills.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <span>
                  {s.id} ({s.skill.name})
                </span>
                <Button size="sm" onClick={() => void removeSkill(s.id)}>
                  unload
                </Button>
              </li>
            ))}
          </ul>
        )}
        {tools.length > 0 && (
          <>
            <div className="text-sm">
              tools:{" "}
              {tools.map((t) => (
                <Button
                  key={t.name}
                  size="sm"
                  onClick={() => setInvokeName(t.name)}
                  title={t.description}
                >
                  {t.name}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={invokeName}
                onChange={(e) => setInvokeName(e.target.value)}
                placeholder="tool name"
              />
              <Input
                value={invokeInput}
                onChange={(e) => setInvokeInput(e.target.value)}
                placeholder='JSON input, e.g. {"n": 1994}'
              />
              <Button onClick={() => void invokeTool()}>Invoke</Button>
            </div>
            {invokeResult !== null && (
              <pre className="overflow-auto rounded bg-black/5 p-2 text-xs">{invokeResult}</pre>
            )}
          </>
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
