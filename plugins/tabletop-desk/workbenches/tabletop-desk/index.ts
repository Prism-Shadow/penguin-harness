import { integer, requireValue, text, workbench } from "./desk-kit.js";

interface Player {
  id: number;
  name: string;
  initiative: number;
}
interface Roll {
  dice: number[];
  sides: number;
  modifier: number;
  total: number;
  who: string;
}
interface Table {
  players: Player[];
  active: number | null;
  round: number;
  nextId: number;
  notes: string;
  rolls: Roll[];
}
const empty: Table = { players: [], active: null, round: 1, nextId: 1, notes: "", rolls: [] };

export default workbench(empty, (table, a) => {
  switch (a.type) {
    case "join": {
      requireValue(table.players.length < 24, "full");
      const player = {
        id: table.nextId++,
        name: text(a.name, 60),
        initiative: integer(a.initiative, -99, 999),
      };
      table.players.push(player);
      table.players.sort((first, second) => second.initiative - first.initiative);
      // The first arrival takes the first turn. Later arrivals keep the active seat.
      if (table.active === null) table.active = player.id;
      return;
    }
    case "lead": {
      requireValue(table.players.some((p) => p.id === a.id));
      table.active = a.id as number;
      return;
    }
    case "leave": {
      const at = table.players.findIndex((p) => p.id === a.id);
      requireValue(at >= 0);
      table.players.splice(at, 1);
      if (a.id === table.active)
        table.active = table.players[at]?.id ?? table.players[0]?.id ?? null;
      if (!table.players.length) table.round = 1;
      return;
    }
    case "next": {
      requireValue(table.players.length);
      const index =
        (table.players.findIndex((p) => p.id === table.active) + 1) % table.players.length;
      if (index === 0) table.round++;
      table.active = table.players[index]!.id;
      return;
    }
    case "note":
      table.notes = text(a.body, 6000, true);
      return;
    case "roll": {
      const count = integer(a.count, 1, 12),
        sides = integer(a.sides, 4, 100),
        modifier = integer(a.modifier, -99, 99);
      requireValue([4, 6, 8, 10, 12, 20, 100].includes(sides));
      const dice = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
      table.rolls.unshift({
        dice,
        sides,
        modifier,
        total: dice.reduce((sum, face) => sum + face, modifier),
        who: table.players.find((p) => p.id === table.active)?.name ?? "",
      });
      table.rolls = table.rolls.slice(0, 30);
      return;
    }
    default:
      requireValue(false);
  }
});
