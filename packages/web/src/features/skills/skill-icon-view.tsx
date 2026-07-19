/**
 * Skill icon component (shared by Skill library cards and the input area's Skill dropdown):
 * DTO icon (raw icon.svg from the Skill directory) is rendered inline once it passes
 * sanitizeSkillIcon (stroke uses currentColor, following text color); falls back to the
 * default book icon if missing or if validation fails (e.g. user-created Skills).
 */
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { BOOK_ICON } from "../chat/skill-use";
import { sanitizeSkillIcon } from "./skill-icon";

export function SkillIcon({
  icon,
  size = 20,
  className = "",
}: {
  icon?: string;
  size?: number;
  className?: string;
}) {
  const safe = sanitizeSkillIcon(icon);
  if (!safe) return <GlyphIcon d={BOOK_ICON} size={size} className={className} />;
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={`block shrink-0 [&>svg]:block [&>svg]:h-full [&>svg]:w-full ${className}`}
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}
