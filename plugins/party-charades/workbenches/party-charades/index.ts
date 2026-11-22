import { integer, requireValue, workbench } from "./desk-kit.js";
import { WORDS } from "./words.js";
interface Game {
  score: [number, number];
  team: 0 | 1;
  turns: number;
  seconds: number;
  until: number;
  prompt: number;
  word: readonly [string, string] | null;
  deck: number[];
  earned: number;
}
const initial: Game = {
  score: [0, 0],
  team: 0,
  turns: 0,
  seconds: 60,
  until: 0,
  prompt: -1,
  word: null,
  deck: [],
  earned: 0,
};
function next(game: Game) {
  if (!game.deck.length) {
    const pool = WORDS.map((_, i) => i);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    if (pool.at(-1) === game.prompt) [pool[0], pool[pool.length - 1]] = [pool.at(-1)!, pool[0]!];
    game.deck = pool;
  }
  game.prompt = game.deck.pop()!;
  game.word = WORDS[game.prompt]!;
}
export default workbench(initial, (game, a) => {
  if (a.type === "start") {
    requireValue(!game.until);
    game.seconds = integer(a.seconds, 30, 120);
    game.earned = 0;
    game.until = Date.now() + game.seconds * 1000;
    next(game);
    return;
  }
  if (a.type === "reset") {
    requireValue(!game.until);
    Object.assign(game, structuredClone(initial));
    return;
  }
  requireValue(game.until);
  if (a.type === "end") {
    game.score[game.team] += game.earned;
    game.earned = 0;
    game.turns++;
    game.team = game.team === 0 ? 1 : 0;
    game.until = 0;
    game.word = null;
    return;
  }
  requireValue(Date.now() < game.until, "stale");
  requireValue(a.type === "correct" || a.type === "pass");
  if (a.type === "correct") game.earned++;
  next(game);
});
