/**
 * 按钮: the Button in its five variants and five sizes, the icon button, disabled and loading, the
 * link in a sentence and on its own, and the keyboard hint.
 */
import type { MouseEvent } from "react";
import { Button, GlyphIcon, ICONS, IconButton, Kbd, Link, PlusIcon } from "@prismshadow/penguin-ui";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";

const RELEASES_URL = "https://github.com/Prism-Shadow/penguin-harness/releases";

/** The in-sentence link points nowhere real; following it would navigate the board's frame away. */
const stay = (event: MouseEvent) => event.preventDefault();

export function ButtonsBoard() {
  const { S } = useGallery();
  const t = S.library.buttons;
  return (
    <div className="gf-board">
      <BoardGroup title={t.variants}>
        <div className="lib-row">
          <Button variant="primary">{t.primary}</Button>
          <Button variant="secondary">{t.secondary}</Button>
          <Button variant="danger">{t.danger}</Button>
          <Button variant="ghost">{t.ghost}</Button>
          <Button variant="link">{t.link}</Button>
        </div>
      </BoardGroup>
      <BoardGroup title={t.sizes}>
        <div className="lib-row">
          <Button variant="primary" size="md">
            {t.md}
          </Button>
          <Button variant="primary" size="sm">
            {t.sm}
          </Button>
          <Button variant="secondary" size="xs">
            {t.xs}
          </Button>
          <Button variant="secondary" size="sm" leading={<PlusIcon />}>
            {t.leading}
          </Button>
        </div>
      </BoardGroup>
      <BoardGroup title={t.icon} aside={t.iconHint}>
        <div className="lib-row">
          <IconButton label={t.add}>
            <PlusIcon />
          </IconButton>
          <IconButton label={t.add} size="sm">
            <PlusIcon />
          </IconButton>
          <IconButton label={t.edit} variant="ghost">
            <GlyphIcon d={ICONS.pencil} />
          </IconButton>
          <IconButton label={t.danger} variant="danger">
            <GlyphIcon d={ICONS.trash} />
          </IconButton>
        </div>
      </BoardGroup>
      <BoardGroup title={t.states}>
        <div className="lib-row">
          <Button variant="primary" disabled>
            {t.disabled}
          </Button>
          <Button variant="secondary" disabled>
            {t.disabled}
          </Button>
          <Button variant="primary" loading loadingLabel={t.busy}>
            {t.busy}
          </Button>
          <Button variant="secondary" size="sm" loading loadingLabel={t.busy}>
            {t.busy}
          </Button>
          <IconButton label={t.add} loading loadingLabel={t.busy}>
            <PlusIcon />
          </IconButton>
        </div>
      </BoardGroup>
      <BoardGroup title={t.links} aside={t.linksHint}>
        <div className="lib-stack">
          <p className="text-sm">
            {t.inlineBefore}
            <Link href="#release-notes" onClick={stay}>
              {t.inlineLink}
            </Link>
            {t.inlineAfter}
          </p>
          <div className="lib-row">
            <Link href={RELEASES_URL} external variant="standalone" className="text-sm">
              {t.external}
            </Link>
            <Link href={RELEASES_URL} external variant="standalone" className="text-xs">
              {t.external}
            </Link>
          </div>
        </div>
      </BoardGroup>
      <BoardGroup title={t.keys}>
        <div className="lib-row">
          {t.shortcuts.map((keys) => (
            <Kbd key={keys.join("+")} keys={keys} />
          ))}
        </div>
      </BoardGroup>
    </div>
  );
}
