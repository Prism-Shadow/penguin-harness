/** Segmented control (for 2-3-way choices like theme/language): small grayscale style. Shared by the sidebar user menu and the login page. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  cols = 3,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  cols?: 2 | 3;
}) {
  return (
    <div
      className={`grid ${cols === 2 ? "grid-cols-2" : "grid-cols-3"} gap-0.5 rounded-md bg-gray-100 p-0.5 dark:bg-gray-800`}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`rounded px-1 py-1 text-xs transition-colors duration-150 ${
            value === opt.value
              ? "bg-white font-medium text-gray-900 shadow-sm dark:bg-gray-600 dark:text-gray-100"
              : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
