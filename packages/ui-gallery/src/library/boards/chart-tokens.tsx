/**
 * The current theme's chart tokens, live: the palette as swatches and the geometry as values,
 * read from this frame root's computed style — the theme under test, since the frame carries the
 * page's theme attributes — and read again when the root's theme attributes change.
 */
import { useEffect, useState } from "react";
import { useGallery } from "../../state";
import { readChartTokens } from "../chart-tokens";
import type { ChartToken, ChartTokenRow } from "../chart-tokens";

type Tokens = ReturnType<typeof readChartTokens>;

function read(): Tokens {
  const computed = getComputedStyle(document.documentElement);
  return readChartTokens((name) => computed.getPropertyValue(name));
}

function useChartTokens(): Tokens | null {
  const [tokens, setTokens] = useState<Tokens | null>(null);
  useEffect(() => {
    const update = () => setTokens(read());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "data-accent", "style"],
    });
    return () => observer.disconnect();
  }, []);
  return tokens;
}

function TokenRows<T extends ChartToken>({
  rows,
  swatch,
}: {
  rows: readonly ChartTokenRow<T>[];
  /** Paint the value as a colour beside its name. */
  swatch: boolean;
}) {
  const { S } = useGallery();
  return (
    <table className="lib-tokens">
      <tbody>
        {rows.map((row) => (
          <tr key={row.name} data-unset={row.value === "" || undefined}>
            {swatch && (
              <td className="lib-tokens-swatch">
                <span style={{ background: row.value || "transparent" }} aria-hidden />
              </td>
            )}
            <th scope="row">
              <code>{row.name}</code>
            </th>
            <td className="lib-tokens-meaning">{S.library.charts.tokenMeaning[row.name]}</td>
            <td className="lib-tokens-value">
              <code>{row.value || S.section.unset}</code>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ChartTokenTable() {
  const { S } = useGallery();
  const t = S.library.charts;
  const tokens = useChartTokens();
  if (!tokens) return <p className="gf-muted">{S.intro.resolving}</p>;
  return (
    <div className="lib-stack lib-stack-wide">
      <div>
        <p className="lib-caption">{t.palette}</p>
        <TokenRows rows={tokens.palette} swatch />
      </div>
      <div>
        <p className="lib-caption">{t.geometry}</p>
        <TokenRows rows={tokens.geometry} swatch={false} />
      </div>
    </div>
  );
}
