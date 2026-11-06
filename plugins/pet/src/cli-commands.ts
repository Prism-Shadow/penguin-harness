/**
 * The pet's CLI commands: the code the server runs when someone asks for `penguin pet …`
 * against this package. One builder, `registerPetCommands`, fills one commander node with
 * the four subcommands — the `@Bind` field in index.ts hands it the node the server located
 * for the `pet` key, and the tests hand it a fresh one. Every command reads and writes the
 * package's state through the host's state channel (PluginCliCommandHost): the same document
 * the widget's iframe reads over the plugin state routes, so the faces stay one pet.
 *
 * The command prints only what the state holds; the server captures the process's streams
 * for the duration of a run and returns them with the exit code.
 */
import type { Command } from "commander";
import type { CliCommandProgram } from "@prismshadow/penguin-core/cli";
import type { PluginCliCommandHost } from "@prismshadow/penguin-server/plugin";

/** The pet's document, as the persistent and transient facets hold it (server: pet-state.ts). */
interface PetDoc {
  pet?: { name?: string; fullness?: number; food?: number; coins?: number };
  mood?: { doing?: string; bubble?: string | null };
}

const DEFAULT_NAME = { en: "the pet", zh: "宠物" } as const;

/** What one portion of the pantry fills. */
const FULLNESS_PER_PORTION = 20;

/** The name to print: the stored one, or the locale's placeholder. */
function nameOf(doc: PetDoc, language: "en" | "zh"): string {
  return doc.pet?.name ?? DEFAULT_NAME[language];
}

/** One line of status, the way every command's tail prints it. */
function statusLine(doc: PetDoc, language: "en" | "zh"): string {
  const name = nameOf(doc, language);
  const fullness = doc.pet?.fullness ?? 0;
  const food = doc.pet?.food ?? 0;
  const coins = doc.pet?.coins ?? 0;
  const doing = doc.mood?.doing;
  if (language === "zh") {
    const mood = doing ? `，现在${doing}` : "";
    return `${name}：饱食度 ${fullness}/100，食物 ${food} 份，币 ${coins.toFixed(1)}${mood}`;
  }
  const mood = doing ? `, currently ${doing}` : "";
  return `${name}: fullness ${fullness}/100, food ${food}, coins ${coins.toFixed(1)}${mood}`;
}

/**
 * Fills `program` (the node the key `pet` locates) with the subcommands. The host hands the
 * node with the summary already set as its description; this adds options, arguments and
 * actions, and never builds a path of its own.
 */
export function registerPetCommands(program: CliCommandProgram, host: PluginCliCommandHost): void {
  // The contract hands the node over opaque; the commander side of this package fills it in.
  const root = program as unknown as Command;
  const zh = host.language === "zh";

  root
    .command("feed")
    .description(
      zh
        ? "喂宠物：吃一份仓里的食物，饱食度 +20"
        : "Feed the pet: eats one portion from its pantry, fullness +20",
    )
    .option("--portions <n>", zh ? "吃几份" : "how many portions to eat", "1")
    .action(async (opts: { portions: string }) => {
      const doc = host.state.read() as PetDoc;
      const portions = Number(opts.portions);
      if (!Number.isInteger(portions) || portions < 1) {
        process.stderr.write(
          zh ? "份数必须是正整数\n" : "the portions must be a positive whole number\n",
        );
        process.exitCode = 1;
        return;
      }
      const food = doc.pet?.food ?? 0;
      if (food < portions) {
        process.stderr.write(
          zh
            ? `食物不够：库存 ${food} 份，右键宠物用币买一些\n`
            : `not enough food: ${food} portion(s) left — right-click the pet to buy some with coins\n`,
        );
        process.exitCode = 1;
        return;
      }
      const stored = doc.pet?.fullness ?? 0;
      // The server clamps the merged fullness into 0–100; print what it kept.
      const next = (await Promise.resolve(
        host.state.merge({
          pet: {
            fullness: Math.min(100, Math.max(0, stored + FULLNESS_PER_PORTION * portions)),
            food: food - portions,
          },
        }),
      )) as PetDoc;
      process.stdout.write(
        zh
          ? `${nameOf(next, "zh")} 吃饱了：饱食度 ${next.pet?.fullness ?? 0}/100，食物 ${next.pet?.food ?? 0} 份\n`
          : `${nameOf(next, "en")} ate: fullness ${next.pet?.fullness ?? 0}/100, ${next.pet?.food ?? 0} portion(s) left\n`,
      );
    });

  root
    .command("name")
    .description(zh ? "给宠物起名" : "Name the pet")
    .argument("<name>", zh ? "宠物的名字" : "the pet's name")
    .action(async (name: string) => {
      await Promise.resolve(host.state.merge({ pet: { name } }));
      process.stdout.write(zh ? `它现在叫 ${name}\n` : `It is now named ${name}\n`);
    });

  root
    .command("say")
    .description(zh ? "让宠物说一句话（气泡）" : "Make the pet say one line (its bubble)")
    .argument("<text>", zh ? "要说的话" : "the line to say")
    .action(async (text: string) => {
      await Promise.resolve(host.state.merge({ mood: { bubble: text, doing: "idle" } }));
      process.stdout.write(zh ? `它说：${text}\n` : `It says: ${text}\n`);
    });

  root
    .command("status")
    .description(zh ? "看宠物现在怎么样" : "How the pet is doing")
    .action(() => {
      const doc = host.state.read() as PetDoc;
      process.stdout.write(`${statusLine(doc, host.language)}\n`);
    });
}
