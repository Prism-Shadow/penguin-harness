import {
  t,
  zh,
  desk,
  node,
  row,
  section,
  heading,
  hint,
  field,
  select,
  form,
  button,
  confirmAction,
} from "./desk-kit.js";
const teamName = (i) => (i === 0 ? t("Team A", "甲队") : t("Team B", "乙队"));
let timer;
desk(t("Party Charades", "派对猜词"), (game, { send }) => {
  clearInterval(timer);
  const time = node("span", {}),
    clock = node("p", { className: "hint" }, time);
  const hero = node("div", { className: "hero" });
  if (game.until) {
    const word = node("p", { className: "readout" });
    const correct = button(t("Guessed it", "猜中了"), () => send({ type: "correct" }), true),
      pass = button(t("Pass", "跳过"), () => send({ type: "pass" })),
      finish = button(t("Finish turn", "结束本轮"), () => send({ type: "end" }));
    const tick = () => {
      const left = Math.max(0, Math.ceil((game.until - Date.now()) / 1000));
      time.textContent = left
        ? t("Seconds left ", "剩余秒数 ") + left
        : t("Finish the turn to add this turn’s points.", "点「结束本轮」把本轮得分记上。");
      word.textContent = left ? game.word?.[zh ? 1 : 0] : t("Time’s up", "时间到");
      correct.disabled = pass.disabled = !left;
      // Once time is up, finishing the turn is the one thing left to do.
      finish.classList.toggle("wb-primary", !left);
      if (!left) clearInterval(timer);
    };
    timer = setInterval(tick, 250);
    tick();
    hero.append(
      heading(teamName(game.team)),
      word,
      clock,
      hint(t("Guessed this turn: ", "本轮猜中 ") + game.earned),
      row(correct, pass, finish),
    );
  } else {
    hero.append(
      heading(t("Next up", "下一组")),
      node("p", { className: "readout" }, teamName(game.team)),
      hint(
        t(
          "Hand the screen to the actor. Act out the prompt without speaking while your team guesses.",
          "把屏幕交给表演者。表演者只用动作提示，队友负责猜词。",
        ),
      ),
      form(
        "round",
        t("Reveal and start", "揭词并开始"),
        (v) => send({ type: "start", seconds: Number(v.seconds) }),
        field(
          t("Turn length", "每轮时长"),
          select(
            "seconds",
            [30, 60, 90, 120].map((s) => [s, s + t(" seconds", " 秒")]),
            String(game.seconds),
          ),
        ),
      ),
    );
  }
  const reset = button(t("New match", "新比赛"), async () => {
    if (
      await confirmAction(
        t("Clear both teams’ scores and start a new match?", "清空两队比分并重新开始比赛？"),
        t("New match", "新比赛"),
      )
    )
      void send({ type: "reset" });
  });
  reset.disabled = !!game.until || !game.turns;
  return [
    hero,
    section(
      t("Scoreboard", "计分板"),
      node(
        "div",
        { className: "scores" },
        [0, 1].map((i) =>
          node("div", {}, heading(teamName(i)), node("strong", {}, String(game.score[i]))),
        ),
      ),
      hint(t("Completed turns: ", "已完成轮次 ") + game.turns),
      reset,
    ),
  ];
});
