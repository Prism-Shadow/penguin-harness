/**
 * Plugin detail Modal — opened by clicking a library card (the model library's card-detail
 * pattern): the plugin's icon, full description and metadata line, then what it ships — its
 * skills (each row opens a simple SKILL.md reader inside the same Modal) and the hook points
 * its hook package answers at. The reader fetches one skill's markdown on demand
 * (GET /api/plugins/:plugin/skills/:skill) and renders the body with the chat markdown
 * component, frontmatter stripped.
 */
import { useState } from "react";
import { Modal } from "../../components/ui/modal";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { HOOK_ICON } from "../../components/ui/icons";
import { S } from "../../lib/strings";
import { useLocale } from "../../state/locale";
import { getPluginSkillContent } from "../../api/endpoints";
import type { PluginItem, SkillMetadataItem } from "@prismshadow/penguin-server/api";
import { Md } from "../chat/md";
import { SkillIcon, skillTileColor } from "../skills/skill-icon-view";
import { localizedShortText, localizedText } from "../chat/skill-use";

/** The reader's state: which skill is open and its fetched body (null while loading). */
interface Reader {
  skill: SkillMetadataItem;
  body: string | null;
}

/** SKILL.md arrives verbatim; the reader shows the body only. */
function stripFrontmatter(content: string): string {
  return content.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}

export function PluginDetailModal({
  plugin,
  meta,
  onClose,
}: {
  plugin: PluginItem;
  /** The card's metadata line (version · updated · used by N agents), repeated under the title. */
  meta: string;
  onClose: () => void;
}) {
  const { locale } = useLocale();
  const [reader, setReader] = useState<Reader | null>(null);

  const openSkill = (skill: SkillMetadataItem) => {
    setReader({ skill, body: null });
    getPluginSkillContent(plugin.name, skill.name)
      .then((res) =>
        setReader((r) => (r?.skill.name === skill.name ? { skill, body: res.content } : r)),
      )
      .catch(() => setReader((r) => (r?.skill.name === skill.name ? { skill, body: "" } : r)));
  };

  return (
    <Modal
      open
      title={reader ? reader.skill.name : plugin.name}
      onClose={() => (reader ? setReader(null) : onClose())}
      widthClass="max-w-2xl"
    >
      {reader ? (
        <div className="max-h-[65vh] overflow-y-auto pr-1">
          <button
            type="button"
            onClick={() => setReader(null)}
            className="mb-3 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            ← {plugin.name}
          </button>
          {reader.body === null ? (
            <p className="text-sm text-gray-400 dark:text-gray-500">{S.common.loading}</p>
          ) : (
            <div className="text-sm">
              <Md text={stripFrontmatter(reader.body)} />
            </div>
          )}
        </div>
      ) : (
        <div className="max-h-[65vh] overflow-y-auto pr-1">
          {/* Header: icon tile + full description + the card's metadata line. */}
          <div className="flex items-start gap-3">
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${skillTileColor(plugin.name)}`}
            >
              <SkillIcon
                icon={plugin.icon}
                fallback={plugin.skills.length === 0 ? HOOK_ICON : undefined}
                size={22}
              />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                {localizedText(locale, plugin.description, plugin.descriptionZh)}
              </p>
              <p className="mt-1.5 text-[11px] text-gray-400 dark:text-gray-500">{meta}</p>
            </div>
          </div>
          {/* Skills: one row per skill, opening the SKILL.md reader. */}
          {plugin.skills.length > 0 && (
            <div className="mt-4">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                {S.plugins.detailSkills}
              </p>
              <div className="overflow-hidden rounded-md border border-gray-200 dark:border-gray-800">
                {plugin.skills.map((skill) => (
                  <button
                    key={skill.name}
                    type="button"
                    onClick={() => openSkill(skill)}
                    className="flex w-full items-center gap-2.5 border-b border-gray-100 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-gray-50 dark:border-gray-800/60 dark:hover:bg-gray-800/50"
                  >
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${skillTileColor(skill.name)}`}
                    >
                      <SkillIcon icon={skill.icon} size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-xs font-semibold">
                        {skill.name}
                      </span>
                      <span className="block truncate text-[11px] text-gray-500 dark:text-gray-400">
                        {localizedShortText(locale, skill)}
                      </span>
                    </span>
                    <span aria-hidden className="text-gray-300 dark:text-gray-600">
                      ›
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* Hook points: what the plugin's hook package answers at. */}
          {plugin.hooks.length > 0 && (
            <div className="mt-4">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                {S.plugins.detailHooks}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {plugin.hooks.map((event) => (
                  <span
                    key={event}
                    className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 dark:border-gray-800 dark:text-gray-300"
                  >
                    <GlyphIcon d={HOOK_ICON} size={12} className="text-gray-400" />
                    {S.plugins.hookBadge(event)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
