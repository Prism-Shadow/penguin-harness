import { useState } from "react";
import { BenchmarkDetailPage } from "./benchmark-detail-page";
import { BenchmarkPage } from "./benchmark-page";

export function SelfEvolutionWorkbench() {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div className="h-full overflow-auto">
      {selected === null ? (
        <BenchmarkPage onOpen={setSelected} />
      ) : (
        <BenchmarkDetailPage selectedId={selected} onBack={() => setSelected(null)} />
      )}
    </div>
  );
}
