export function FlowDot({
  path,
  dur,
  begin,
  accent = false,
  r = 1.75,
}: {
  path: string;
  dur: string;
  begin: string;
  accent?: boolean;
  r?: number;
}) {
  return (
    <circle
      r={r}
      className={accent ? "fill-brand-500 dark:fill-brand-400" : "fill-gray-400 dark:fill-gray-500"}
    >
      {/* Stop at 90% of the path so the dot never rides over the arrowhead. */}
      <animateMotion
        dur={dur}
        begin={begin}
        repeatCount="indefinite"
        path={path}
        calcMode="linear"
        keyPoints="0;0.9"
        keyTimes="0;1"
      />
    </circle>
  );
}
