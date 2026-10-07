/**
 * Opening a product that is in the WAF workspace's modules, in place.
 *
 * Lists the products no project has open (reading only: nothing is opened by looking) and
 * opens one at a time into this project, which then owns it. Beside each opened product it
 * shows the server's own account of what was repaired or could not be carried, rather than a
 * bare success.
 */
import { useEffect, useMemo, useState } from "react";
import type {
  ClaimModuleProductResponse,
  ModuleProduct,
  ModuleProductsResponse,
} from "@prismshadow/penguin-server/api";
import { apiFetch } from "../../api/client";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneInk, toneStrip } from "../../lib/tone";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { filterModuleProducts, moduleProductKey } from "./module-products";

export function OpenModuleDialog({
  projectId,
  onClose,
  onOpened,
}: {
  projectId: string;
  onClose: () => void;
  onOpened: () => void;
}) {
  const words = S.activities.openFromModules;
  const base = `/api/projects/${encodeURIComponent(projectId)}/activities`;
  const [products, setProducts] = useState<ModuleProduct[] | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [opening, setOpening] = useState<string | null>(null);
  const [results, setResults] = useState<
    Record<string, ClaimModuleProductResponse | { error: string }>
  >({});

  useEffect(() => {
    let live = true;
    apiFetch<ModuleProductsResponse>(`${base}/module-products`)
      .then((value) => {
        if (live) setProducts(value.products);
      })
      .catch((cause: unknown) => {
        if (live) setError(apiErrorText(cause));
      });
    return () => {
      live = false;
    };
  }, [base]);

  const visible = useMemo(() => filterModuleProducts(products ?? [], search), [products, search]);

  async function open(product: ModuleProduct) {
    const key = moduleProductKey(product);
    setOpening(key);
    try {
      const result = await apiFetch<ClaimModuleProductResponse>(`${base}/module-products/claim`, {
        method: "POST",
        body: { moduleFolder: product.moduleFolder, productCode: product.productCode },
      });
      setResults((current) => ({ ...current, [key]: result }));
      onOpened();
    } catch (cause) {
      setResults((current) => ({ ...current, [key]: { error: apiErrorText(cause) } }));
    } finally {
      setOpening(null);
    }
  }

  return (
    <Modal
      open
      title={words.title}
      onClose={onClose}
      footer={
        <Button size="sm" onClick={onClose} disabled={opening !== null}>
          {S.common.close}
        </Button>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-gray-500">{words.help}</p>
        {error && (
          <p role="alert" className={`text-sm ${toneInk.danger}`}>
            {error}
          </p>
        )}
        {!products && !error && (
          <p role="status" className="text-xs text-gray-500">
            {words.loading}
          </p>
        )}
        {products && products.length === 0 && (
          <p className="text-sm text-gray-500">{words.empty}</p>
        )}
        {products && products.length > 0 && (
          <>
            <Input
              size="sm"
              aria-label={words.search}
              placeholder={words.search}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <ul className="max-h-[50vh] space-y-2 overflow-auto">
              {visible.map((product) => {
                const key = moduleProductKey(product);
                const result = results[key];
                const opened = !!result && !("error" in result);
                return (
                  <li
                    key={key}
                    className="space-y-2 rounded-md border border-gray-200 p-3 dark:border-gray-800"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {product.title || product.productCode}
                        </span>
                        <span className="block truncate text-xs text-gray-500">
                          {product.productCode} · {product.moduleFolder} ·{" "}
                          {words.refs(product.refNums.length)}
                        </span>
                      </span>
                      <Button
                        size="sm"
                        variant={opened ? "ghost" : "primary"}
                        disabled={opening !== null || opened}
                        onClick={() => void open(product)}
                      >
                        {opening === key ? words.opening : opened ? words.opened : words.open}
                      </Button>
                    </div>
                    {result && "error" in result && (
                      <p role="alert" className={`text-xs ${toneInk.danger}`}>
                        {result.error}
                      </p>
                    )}
                    {result && !("error" in result) && (
                      <div
                        role="status"
                        className={`space-y-1 rounded-md border p-2 text-xs ${toneStrip[result.problems.length > 0 ? "attention" : "success"]}`}
                      >
                        <p>{result.message}</p>
                        {result.problems.length > 0 && (
                          <ul className="list-disc pl-4">
                            {result.problems.map((problem) => (
                              <li key={problem}>{problem}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
}
