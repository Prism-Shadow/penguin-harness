import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { GlyphIcon, ICONS, InlineIconButton, Spinner, toastError } from "@prismshadow/penguin-ui";
import { S, apiErrorText, apiUrl, boundToolModel, readReplyAloud, useAuth, useToolBindings } from "@prismshadow/penguin-web/internal";
import type { ToolBinding } from "@prismshadow/penguin-web/internal";

/**
 * The voice controls of one chat window: dictation into the composer (dictation.tsx) and reading
 * a reply aloud. Both run on the Project's multimodal tools — speech recognition and speech
 * synthesis — on the server the Session lives on, and show only while the plugin is on there
 * and a model is bound. Reading aloud keeps its audio in the Session (the plugin reuses it by
 * Session, reply and voice model), so a draft, which has no Session yet, offers none.
 */
type Playback = { id: string; phase: "loading" | "playing" | "ready" };
interface VoiceState {
  projectId: string;
  server: string | null;
  sessionId: string | undefined;
  active: boolean;
  bindings: ToolBinding[] | null;
  readCurrent: (signal: AbortSignal) => Promise<ToolBinding[] | null>;
  playback: Playback | null;
  speak: (id: string, text: string) => void;
  stop: (replyId?: string) => void;
}
const VoiceContext = createContext<VoiceState | null>(null);
export function useVoice() {
  return useContext(VoiceContext);
}

export function VoiceScope({
  projectId,
  server,
  sessionId,
  active,
  children,
}: {
  projectId: string;
  server: string | null;
  sessionId: string | undefined;
  active: boolean;
  children: ReactNode;
}) {
  const listener = useAuth().user?.userId;
  const replays = useRef(new Map<string, { text: string; model: string; url: string }>());
  const { bindings, readCurrent } = useToolBindings(active ? projectId : null, server);
  const canSpeak = sessionId !== undefined && boundToolModel(bindings, "t2s") !== undefined;
  const [playback, setPlayback] = useState<Playback | null>(null);
  const current = useRef<{ request: AbortController; audio: HTMLAudioElement; id: string } | null>(
    null,
  );
  const stop = useCallback((replyId?: string) => {
    const item = current.current;
    if (replyId !== undefined && item?.id !== replyId) return;
    current.current = null;
    if (item) {
      item.request.abort();
      item.audio.onended = null;
      item.audio.onerror = null;
      item.audio.pause();
      item.audio.removeAttribute("src");
      item.audio.load();
    }
    setPlayback(null);
  }, []);
  useLayoutEffect(() => {
    replays.current.clear();
    return stop;
  }, [projectId, server, sessionId, listener, active, canSpeak, stop]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) stop();
    };
    const pageHide = () => stop();
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", pageHide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", pageHide);
    };
  }, [stop]);
  const speak = async (id: string, text: string) => {
    const previous = current.current;
    if (previous?.id === id && playback?.phase !== "ready") {
      stop();
      return;
    }
    if (!active || !canSpeak || sessionId === undefined) return;
    let item = previous?.id === id ? previous : null;
    try {
      if (!item) {
        stop();
        const request = new AbortController(),
          audio = new Audio();
        item = { request, audio, id };
        current.current = item;
        setPlayback({ id, phase: "loading" });
        // The binding as it is now: another tab may have changed the voice since this one read it.
        const binding = boundToolModel(await readCurrent(request.signal), "t2s");
        if (current.current !== item) return;
        if (!binding) {
          stop(id);
          return;
        }
        const model = JSON.stringify([binding.provider, binding.modelId]);
        const cached = replays.current.get(id);
        let url = cached?.text === text && cached.model === model ? cached.url : undefined;
        if (!url) {
          const spoken = await readReplyAloud(
            projectId,
            server,
            { text, sessionId },
            request.signal,
          );
          if (current.current !== item) return;
          if (!spoken.url.startsWith("/api/")) throw new Error(S.voice.audioError);
          url = spoken.url;
          replays.current.set(id, {
            text,
            model: JSON.stringify([spoken.model.provider, spoken.model.modelId]),
            url,
          });
        }
        audio.onended = () => stop(id);
        audio.onerror = () => {
          if (current.current === item) {
            replays.current.delete(id);
            stop();
            toastError(S.voice.audioError);
          }
        };
        audio.src = apiUrl(url, server);
      }
      await item.audio.play();
      if (current.current === item) setPlayback({ id, phase: "playing" });
    } catch (e) {
      if (!item || current.current !== item) return;
      if (e instanceof DOMException && e.name === "NotAllowedError" && item.audio.src) {
        setPlayback({ id, phase: "ready" });
        return;
      }
      replays.current.delete(id);
      stop();
      toastError(apiErrorText(e));
    }
  };
  return (
    <VoiceContext.Provider
      value={{
        projectId,
        server,
        sessionId,
        active,
        bindings,
        readCurrent,
        playback,
        speak: (id, text) => void speak(id, text),
        stop,
      }}
    >
      {children}
    </VoiceContext.Provider>
  );
}

export function ReadReply({ text }: { text: string }) {
  const scope = useVoice(),
    id = useId();
  const stop = scope?.stop;
  useEffect(() => () => stop?.(id), [stop, id]);
  if (!scope?.sessionId || boundToolModel(scope.bindings, "t2s") === undefined || !text.trim())
    return null;
  const own = scope.playback?.id === id ? scope.playback.phase : null;
  const label = own === "ready" ? S.voice.play : own ? S.voice.stop : S.voice.listen;
  return (
    <InlineIconButton
      label={label}
      aria-pressed={own === "playing" || own === "loading"}
      onClick={() => scope.speak(id, text)}
      className="shrink-0"
    >
      {own === "loading" ? (
        <Spinner size="sm" label={S.voice.preparing} />
      ) : (
        <GlyphIcon d={own === "playing" ? ICONS.square : ICONS.speaker} />
      )}
    </InlineIconButton>
  );
}
