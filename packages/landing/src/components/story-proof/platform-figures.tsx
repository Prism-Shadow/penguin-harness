import type { ReactNode } from "react";

function Deck({ word }: { word: string }) {
  return (
    <g aria-hidden="true">
      <ellipse cx="279" cy="256" rx="193" ry="31" fill="#315c4f" opacity=".10" />
      <path
        d="m43 199 292-64 186 39v18c0 9-6 12-14 14l-263 71c-10 3-18 3-28 0L55 231c-7-2-12-7-12-14Z"
        fill="#243b39"
      />
      <path
        d="m43 199 284-75c5-2 11-2 17 0l165 39c17 4 18 13 3 18l-274 75c-7 2-13 2-21 0L56 215c-15-4-18-12-13-16Z"
        fill="#d1e9da"
        stroke="#396554"
        strokeWidth="2"
      />
      <path d="m53 219 163 43q10 3 22 0l270-73" fill="none" stroke="#90d3b2" strokeWidth="2" />
      <path d="m89 197 237-62 147 34-238 64Z" fill="#afcfbd" opacity=".75" />
      <text
        x="268"
        y="252"
        transform="rotate(-15 268 252)"
        fill="#e2eee6"
        fontSize="10"
        fontWeight="650"
        letterSpacing="1.2"
      >
        {word}
      </text>
      <circle cx="69" cy="224" r="2.4" fill="#82e6b8" />
      <circle cx="78" cy="227" r="2.4" fill="#82e6b8" />
    </g>
  );
}

function Window({
  x,
  y,
  color,
  children,
}: {
  x: number;
  y: number;
  color: string;
  children: ReactNode;
}) {
  return (
    <g transform={`translate(${x} ${y}) skewY(-12)`}>
      <path d="M6 3 12 0h116q5 0 5 5v86l-6 4Z" fill="#39574b" stroke="#39574b" strokeWidth="2" />
      <rect
        x="4"
        y="4"
        width="124"
        height="91"
        rx="6"
        fill="#fffef9"
        stroke="#39574b"
        strokeWidth="2"
      />
      <path d="M10 5h111q6 0 6 6v9H5V11q0-6 5-6Z" fill={color} />
      <circle cx="13" cy="12" r="2" fill="#38574e" />
      <circle cx="20" cy="12" r="2" fill="#38574e" />
      {children}
    </g>
  );
}

const names = {
  en: ["Release checklist", "Run scores", "Document questions"],
  zh: ["上线清单", "评估结果", "文档问答"],
} as const;
export function ApplicationFigure({
  selected,
  onSelect,
  lang,
}: {
  selected: number;
  onSelect: (i: number) => void;
  lang: "en" | "zh";
}) {
  const choose = (i: number) => ({
    role: "button",
    tabIndex: 0,
    "aria-label": names[lang][i],
    "aria-pressed": i === selected,
    onClick: () => onSelect(i),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect(i);
      }
    },
  });
  return (
    <svg
      className="proof-object"
      viewBox="0 0 560 295"
      role="group"
      aria-label={
        lang === "zh" ? "一个操作系统里的三个应用" : "Three applications on one operating system"
      }
    >
      <Deck word="PenguinHarness OS" />
      <path d="m90 197 70-18 53 15 68-18 63 16 84-22" stroke="#fff" strokeWidth="3" fill="none" />
      <g {...choose(1)} className="object-choice" data-selected={selected === 1}>
        <title>{names[lang][1]}</title>
        <ellipse cx="158" cy="181" rx="64" ry="10" fill="#668977" opacity=".24" />
        <Window x={85} y={82} color="#e9d49d">
          <path d="M20 75h91" stroke="#989a85" />
          {[15, 29, 21, 39, 46].map((h, i) => (
            <rect
              key={h}
              x={23 + i * 17}
              y={74 - h}
              width="11"
              height={h}
              rx="2"
              fill={i === 4 ? "#ae7838" : "#d8bc77"}
            />
          ))}
        </Window>
      </g>
      <g {...choose(2)} className="object-choice" data-selected={selected === 2}>
        <title>{names[lang][2]}</title>
        <ellipse cx="393" cy="153" rx="61" ry="9" fill="#668977" opacity=".24" />
        <Window x={321} y={52} color="#c7b6dd">
          <path d="M21 31h48l16 15v35H21Z" fill="#f4f0f8" stroke="#9074a6" strokeWidth="2" />
          <path d="M69 31v15h16m-53 9h33m-33 8h25" fill="none" stroke="#94819e" strokeWidth="2.6" />
          <circle cx="91" cy="57" r="13" fill="#f7f3fc" stroke="#795594" strokeWidth="4" />
          <path d="m100 68 12 12" stroke="#795594" strokeWidth="5" strokeLinecap="round" />
        </Window>
      </g>
      <g {...choose(0)} className="object-choice" data-selected={selected === 0}>
        <title>{names[lang][0]}</title>
        <ellipse cx="281" cy="206" rx="72" ry="12" fill="#5e8977" opacity=".3" />
        <Window x={208} y={116} color="#8bccad">
          {[32, 51, 70].map((y, i) => (
            <g key={y}>
              <rect
                x="17"
                y={y}
                width="10"
                height="10"
                rx="2"
                fill={i === 0 ? "#269770" : "#f3faf5"}
                stroke="#508c72"
              />
              {i === 0 && (
                <path d={`m19 ${y + 5} 2 2 4-5`} stroke="white" fill="none" strokeWidth="1.4" />
              )}
              <path
                d={`M36 ${y + 3}h${62 - i * 9}M36 ${y + 8}h${36 - i * 3}`}
                stroke="#708b7c"
                strokeWidth="2.3"
                strokeLinecap="round"
              />
            </g>
          ))}
        </Window>
      </g>
    </svg>
  );
}

export function EvolutionFigure({
  selected,
  onSelect,
  lang,
  decision,
}: {
  selected: "coverage" | "filing";
  onSelect: (id: "coverage" | "filing") => void;
  lang: "en" | "zh";
  decision: "baseline" | "candidate" | null;
}) {
  const zh = lang === "zh";
  const center = (id: "coverage" | "filing") => ({
    role: "button",
    tabIndex: 0,
    "aria-label":
      id === "coverage"
        ? zh
          ? "核赔 Agent"
          : "Coverage agent"
        : zh
          ? "归档 Agent"
          : "Filing agent",
    "aria-pressed": selected === id,
    onClick: () => onSelect(id),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect(id);
      }
    },
  });
  return (
    <svg
      className="proof-object"
      viewBox="0 0 560 295"
      role="group"
      aria-label={
        zh
          ? "两个 Agent 回到共用的评估与复测平台"
          : "Two agents return to the same evaluation and retest platform"
      }
    >
      <defs>
        {["#208366", "#84639c"].map((color, i) => (
          <marker
            key={color}
            id={"proof-loop-" + i}
            markerWidth="5"
            markerHeight="5"
            refX="4"
            refY="2.5"
            orient="auto"
          >
            <path d="m0 0 5 2.5L0 5Z" fill={color} />
          </marker>
        ))}
      </defs>
      <Deck word="PenguinHarness RSI" />
      <g
        className="proof-loop"
        data-current={selected === "coverage"}
        fill="none"
        stroke="#208366"
        strokeWidth="4"
        strokeLinecap="round"
      >
        <path d="M232 170C140 193 72 151 99 97" markerEnd="url(#proof-loop-0)" />
        <path d="M144 84C204 62 248 80 258 128" markerEnd="url(#proof-loop-0)" />
      </g>
      <g
        className="proof-loop"
        data-current={selected === "filing"}
        fill="none"
        stroke="#84639c"
        strokeWidth="4"
        strokeLinecap="round"
      >
        <path d="M319 157C385 172 469 131 447 80" markerEnd="url(#proof-loop-1)" />
        <path d="M406 71C354 52 313 79 302 124" markerEnd="url(#proof-loop-1)" />
      </g>
      <g {...center("coverage")} className="object-choice" data-selected={selected === "coverage"}>
        <title>{zh ? "核赔 Agent" : "Coverage agent"}</title>
        <g transform="translate(77 46) skewY(-10)">
          <path
            d="M6 29 43 9l38 7v35q0 28-38 48Q6 84 6 59Z"
            fill="#498e76"
            stroke="#315d51"
            strokeWidth="2"
          />
          <path
            d="m6 25 35-16 31 7v33q0 25-31 41Q6 79 6 54Z"
            fill="#addec7"
            stroke="#315d51"
            strokeWidth="2"
          />
          <path
            d="m24 50 12 10 21-25"
            fill="none"
            stroke="#336552"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      </g>
      <g {...center("filing")} className="object-choice" data-selected={selected === "filing"}>
        <title>{zh ? "归档 Agent" : "Filing agent"}</title>
        <g transform="translate(385 32) skewY(-10)">
          <path
            d="M2 31V17q0-4 5-4h25l8 8h41v54L9 89Z"
            fill="#b8a4c9"
            stroke="#6f597d"
            strokeWidth="2"
          />
          <path d="M14 23h48v43H14Z" fill="#fffdf8" stroke="#8b7a91" />
          <path d="M24 33h25m-25 8h19" stroke="#aa9caa" strokeWidth="2" />
          <path d="m4 44 77-11-7 48-64 12Z" fill="#d7cae3" stroke="#745e84" strokeWidth="2" />
          <path d="m23 56 31-4" stroke="#9a85ab" strokeWidth="3" />
        </g>
      </g>
      <g aria-hidden="true">
        <ellipse cx="281" cy="179" rx="68" ry="22" fill="#3e7462" />
        <path d="M213 164v15c0 12 30 22 68 22s68-10 68-22v-15" fill="#38594f" />
        <ellipse
          cx="281"
          cy="164"
          rx="68"
          ry="23"
          fill="#93c5ae"
          stroke="#3d6b57"
          strokeWidth="2"
        />
        <ellipse cx="281" cy="162" rx="48" ry="14" fill="none" stroke="#d7f1df" strokeWidth="3" />
        <g transform="translate(265 110) skewY(-12)">
          <path d="M0 1h37l11 10v42H0Z" fill="#fffdf5" stroke="#466b58" strokeWidth="2" />
          <path d="M37 1v11h11m-37 9h24m-24 7h18" fill="none" stroke="#86a591" strokeWidth="2" />
          <path
            d={decision === "baseline" ? "m17 39-5 3 5 4m-4-4h12" : "m14 41 4 4 9-11"}
            stroke="#287b59"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
          />
        </g>
      </g>
    </svg>
  );
}
