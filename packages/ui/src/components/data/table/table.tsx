/**
 * The data table: a header row in the small rung, medium weight and muted ink, ruled off from the
 * body; rows ruled off from each other that lighten under the pointer; two densities.
 *
 * A table on its own is framed — a bordered box on the surface that scrolls sideways when the
 * columns outgrow it, with the header on the muted strip — and carries the `ui-frame` hook like a
 * card, so a theme redraws both boxes alike. A table inside a card is bare (`framed={false}`): the
 * card is the box, and the header keeps its rung and its rule without a strip.
 *
 *   <Table>
 *     <TableHead>
 *       <TableHeaderCell>Name</TableHeaderCell>
 *       <TableHeaderCell align="right">Cost</TableHeaderCell>
 *     </TableHead>
 *     <TableBody>
 *       <TableRow>
 *         <TableCell>alpha</TableCell>
 *         <TableCell numeric>$0.12</TableCell>
 *       </TableRow>
 *     </TableBody>
 *   </Table>
 */
import { createContext, useContext } from "react";
import type {
  HTMLAttributes,
  ReactNode,
  TableHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from "react";

export type TableSize = "sm" | "md";

interface TableContextValue {
  size: TableSize;
  framed: boolean;
}

const TableContext = createContext<TableContextValue>({ size: "md", framed: true });

/** A cell's padding per density; the header and the body share it, so columns line up. */
const CELL: Record<TableSize, string> = {
  sm: "px-2 py-1.5",
  md: "px-3 py-2",
};

export interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
  /** `md` on a page (the default), `sm` in a dialog, a card or a dense panel. */
  size?: TableSize;
  /** Its own bordered box (the default); `false` inside a card, which is the box. */
  framed?: boolean;
  /** Read by assistive technology only: what the table lists. */
  caption?: ReactNode;
  /** On the box around the table: its place in the page. */
  className?: string;
  /** On the table: a minimum width for the columns, a fixed layout. */
  tableClassName?: string;
  children?: ReactNode;
}

export function Table({
  size = "md",
  framed = true,
  caption,
  className = "",
  tableClassName = "",
  children,
  ...rest
}: TableProps) {
  return (
    <TableContext.Provider value={{ size, framed }}>
      <div
        className={`${
          framed
            ? "ui-frame overflow-x-auto overflow-y-clip rounded-md border border-line bg-surface"
            : "overflow-x-auto"
        } ${className}`}
      >
        <table
          {...rest}
          className={`w-full text-left ${size === "sm" ? "text-xs" : "text-sm"} ${tableClassName}`}
        >
          {caption !== undefined && <caption className="sr-only">{caption}</caption>}
          {children}
        </table>
      </div>
    </TableContext.Provider>
  );
}

/** The header: one row of `TableHeaderCell`s. */
export function TableHead({ children }: { children?: ReactNode }) {
  const { framed } = useContext(TableContext);
  return (
    <thead>
      <tr
        className={`border-b border-line text-xs text-fg-muted ${framed ? "bg-surface-muted" : ""}`}
      >
        {children}
      </tr>
    </thead>
  );
}

export type TableAlign = "left" | "center" | "right";

const ALIGN: Record<TableAlign, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

export interface TableHeaderCellProps extends ThHTMLAttributes<HTMLTableCellElement> {
  align?: TableAlign;
  children?: ReactNode;
}

/** A column's name. Headers never wrap; an empty one heads an actions column. */
export function TableHeaderCell({
  align = "left",
  className = "",
  children,
  ...rest
}: TableHeaderCellProps) {
  const { size } = useContext(TableContext);
  return (
    <th
      scope="col"
      {...rest}
      className={`${CELL[size]} whitespace-nowrap font-medium ${ALIGN[align]} ${className}`}
    >
      {children}
    </th>
  );
}

export function TableBody({ children }: { children?: ReactNode }) {
  return <tbody>{children}</tbody>;
}

/** A body row: ruled off from the next, lighter under the pointer. */
export function TableRow({
  className = "",
  children,
  ...rest
}: HTMLAttributes<HTMLTableRowElement> & { children?: ReactNode }) {
  return (
    <tr
      {...rest}
      className={`border-b border-line-muted transition-colors duration-150 last:border-b-0 hover:bg-surface-muted ${className}`}
    >
      {children}
    </tr>
  );
}

export interface TableCellProps extends TdHTMLAttributes<HTMLTableCellElement> {
  align?: TableAlign;
  /** A figure: tabular, and right-aligned unless `align` says otherwise. */
  numeric?: boolean;
  /** Keep the cell on one line. */
  nowrap?: boolean;
  children?: ReactNode;
}

export function TableCell({
  align,
  numeric = false,
  nowrap = false,
  className = "",
  children,
  ...rest
}: TableCellProps) {
  const { size } = useContext(TableContext);
  const side = align ?? (numeric ? "right" : "left");
  return (
    <td
      {...rest}
      className={`${CELL[size]} ${ALIGN[side]} ${numeric ? "tabular-nums" : ""} ${
        nowrap ? "whitespace-nowrap" : ""
      } ${className}`}
    >
      {children}
    </td>
  );
}
