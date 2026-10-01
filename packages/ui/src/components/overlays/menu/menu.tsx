/**
 * The menu rows: one row family, at two densities, for every menu a Dropdown (or a context menu)
 * opens. Built on the menu panel's row states (`menuRowClass`, `menuRowTone`, `ChoiceCheck`), so
 * an action row, a current choice and a destructive row read the same wherever they are offered.
 *
 * - `Menu` is the list: `role="menu"`, named by `label`, and the density its rows take — `md`
 *   (the body rung) for an account or project menu, `sm` (the small rung) for a row's overflow
 *   and context menus. The panel around it stays the caller's `Dropdown`, which owns placement,
 *   dismissal and the Up/Down walk.
 * - `MenuItem` is one row: an optional leading glyph, the label (and a muted description under
 *   it), an optional trailing note, and the check slot when it stands for a choice. A glyph given
 *   as a registry path is decorative (`ui-icon-decor`, role `menu`) and muted; a node (an avatar,
 *   a spinner) is drawn as given. `danger` sets the row in the danger tone, its glyph with it.
 *   With `href` the row is a link — a download, say — rather than a button.
 * - `MenuRadioItem` is a row that picks one of several (`menuitemradio` inside a Menu).
 * - `MenuSeparator` rules one group of rows off from the next; `MenuLabel` names the group below
 *   it in the small muted rung.
 *
 * Outside a `Menu` the rows are plain buttons with no menu role — a picker's list or a panel that
 * mixes rows with other controls uses them that way, and adds whatever role its container needs
 * (`role="option"` makes the row a listbox option, its state `aria-selected`).
 */
import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { ICON_GAP } from "../../../icon-scale";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ChoiceCheck, menuRowClass, menuRowTone } from "../menu-panel/menu-panel";

/** A menu's row density: `md` rows on the body rung, `sm` rows on the small rung. */
export type MenuDensity = "sm" | "md";

const densityText: Record<MenuDensity, string> = { sm: "text-xs", md: "text-sm" };

interface MenuScope {
  density: MenuDensity;
  /** Inside a `Menu`: rows take the menu roles. */
  inMenu: boolean;
}

const MenuScopeContext = createContext<MenuScope>({ density: "md", inMenu: false });

export function Menu({
  label,
  density = "md",
  className,
  children,
}: {
  /** The menu's accessible name, when the trigger that opened it does not already give one. */
  label?: string;
  /** Row density for every row inside (a row may still override it). */
  density?: MenuDensity;
  className?: string;
  children: ReactNode;
}) {
  return (
    <MenuScopeContext.Provider value={{ density, inMenu: true }}>
      <div role="menu" aria-label={label} className={className}>
        {children}
      </div>
    </MenuScopeContext.Provider>
  );
}

/** The roles a row may take: a menu's three, or a listbox option. */
export type MenuItemRole = "menuitem" | "menuitemcheckbox" | "menuitemradio" | "option";

export interface MenuItemProps {
  /** The row's words. */
  label: ReactNode;
  /** Runs when the row is chosen (for a link row, as it navigates). */
  onSelect?: () => void;
  /**
   * The leading mark: a registry path (drawn as a decorative, muted glyph) or a node the caller
   * sized — an avatar, a provider logo, a spinner.
   */
  glyph?: string | ReactNode;
  /** A muted line under the label saying what the row does or when it applies. */
  description?: ReactNode;
  /** A muted note at the row's end: a keyboard shortcut, a count, a version, why it is disabled. */
  trailing?: ReactNode;
  /** Destructive: the row and its glyph take the danger tone. */
  danger?: boolean;
  /**
   * Makes the row a choice: the current one is filled, set in the medium weight and checked, and
   * every choice keeps the check's slot so the rows of one list align.
   */
  checked?: boolean;
  disabled?: boolean;
  /** Render the row as a link to this address instead of a button. */
  href?: string;
  /** With `href`: download the target under this file name. */
  download?: string;
  /** Overrides the density of the enclosing `Menu`. */
  density?: MenuDensity;
  /** Overrides the role the row takes from its container (see the module header). */
  role?: MenuItemRole;
  /** Layout extras on the row (a width, a margin); its look is the family's. */
  className?: string;
  "aria-label"?: string;
  /** ARIA the caller's container needs on the row (`aria-current` on the open one, say). */
  [aria: `aria-${string}`]: string | number | boolean | undefined;
  /** Test and state hooks the caller reads back (`data-testid`, a hint, an id the row stands for). */
  [data: `data-${string}`]: string | number | boolean | undefined;
}

/** Whether an optional slot has anything to draw (`cond && <X />` leaves `false` behind). */
const shown = (node: ReactNode): boolean =>
  node !== undefined && node !== null && node !== false && node !== "";

/** The ARIA state a choice row carries, by its role. */
function choiceState(
  role: MenuItemRole | undefined,
  checked: boolean | undefined,
): { "aria-checked"?: boolean; "aria-selected"?: boolean } {
  if (checked === undefined || role === undefined || role === "menuitem") return {};
  return role === "option" ? { "aria-selected": checked } : { "aria-checked": checked };
}

export function MenuItem({
  label,
  onSelect,
  glyph,
  description,
  trailing,
  danger = false,
  checked,
  disabled = false,
  href,
  download,
  density,
  role,
  className = "",
  ...rest
}: MenuItemProps) {
  const scope = useContext(MenuScopeContext);
  const size = density ?? scope.density;
  const resolvedRole =
    role ?? (scope.inMenu ? (checked === undefined ? "menuitem" : "menuitemcheckbox") : undefined);
  const tone = danger
    ? "text-tone-danger-fg hover:bg-tone-danger-bg"
    : menuRowTone(checked === true);
  const rowClass = `flex items-center ${ICON_GAP.menu} ${menuRowClass} ${densityText[size]} ${tone} disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent ${className}`;
  const lead = !shown(glyph) ? null : typeof glyph === "string" ? (
    <GlyphIcon d={glyph} decor="menu" className={danger ? "" : "text-fg-subtle"} />
  ) : (
    <span className="flex shrink-0 items-center">{glyph}</span>
  );
  const body = (
    <>
      {lead}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {shown(description) && (
          <span className="mt-0.5 block text-xs text-fg-muted">{description}</span>
        )}
      </span>
      {shown(trailing) && <span className="shrink-0 text-xs text-fg-subtle">{trailing}</span>}
      {checked !== undefined && <ChoiceCheck on={checked} />}
    </>
  );
  if (href !== undefined) {
    return (
      <a
        {...rest}
        href={href}
        download={download}
        role={resolvedRole}
        onClick={onSelect}
        className={rowClass}
      >
        {body}
      </a>
    );
  }
  return (
    <button
      {...rest}
      type="button"
      role={resolvedRole}
      {...choiceState(resolvedRole, checked)}
      disabled={disabled}
      onClick={onSelect}
      className={rowClass}
    >
      {body}
    </button>
  );
}

export type MenuRadioItemProps = Omit<MenuItemProps, "checked"> & {
  /** Whether this is the current choice of its group. */
  checked: boolean;
};

/** A row that picks one of several: `menuitemradio` inside a Menu, the choice look everywhere. */
export function MenuRadioItem({ checked, role, ...props }: MenuRadioItemProps) {
  const { inMenu } = useContext(MenuScopeContext);
  return (
    <MenuItem {...props} checked={checked} role={role ?? (inMenu ? "menuitemradio" : undefined)} />
  );
}

/** The rule between two groups of rows. */
export function MenuSeparator() {
  return <div role="separator" className="my-1 border-t border-line-muted" />;
}

/** A group's name, above its rows, in the small muted rung; it is not a row and takes no focus. */
export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <div role="presentation" className="px-3 pb-0.5 pt-1.5 text-xs font-medium text-fg-subtle">
      {children}
    </div>
  );
}
