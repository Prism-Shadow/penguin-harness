/**
 * Three wide rows under the hero, each the app live in a frame beside one claim about it: a
 * self-evolution round in a conversation, the Evaluation Center's score line, the self-evolution
 * toolkits in the plugin market. The claim is a title, one grey sentence and one link into the
 * docs; the frame and the text swap sides from row to row on wide screens, and on narrow ones the
 * text comes first. Flat panels on the page, no section header: the rows are the header.
 */
import { S } from "../lib/strings";
import { DOCS_URL } from "../lib/links";
import { RSI_TOOLKITS } from "../lib/rsi-stats";
import type { SurfaceId } from "../lib/live-frame";
import { useReveal } from "../lib/reveal";
import { useLocale } from "../state/locale";
import type { Locale } from "../state/locale";
import { LiveAppFrame } from "../components/live-app-frame";
import { ArrowRightIcon } from "../components/icons";

/** The paper toolkits' names as a sentence lists them: the Default loop is named apart. */
function paperToolkits(locale: Locale): string {
  const names = RSI_TOOLKITS.filter((toolkit) => toolkit.href !== null).map((t) => t.label);
  if (locale === "zh") return names.join("、");
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function Row({
  surface,
  title,
  text,
  link,
  href,
  frameTitle,
  flip,
}: {
  surface: SurfaceId;
  title: string;
  text: string;
  link: string;
  href: string;
  frameTitle: string;
  /** The frame on the left, the text on the right (wide screens). */
  flip: boolean;
}) {
  const ref = useReveal<HTMLElement>();
  return (
    <article
      ref={ref}
      className={`grid gap-7 rounded-2xl bg-gray-50 p-5 sm:p-8 lg:gap-10 dark:bg-gray-900/60 ${flip ? "lg:grid-cols-[minmax(0,2.3fr)_minmax(0,1fr)]" : "lg:grid-cols-[minmax(0,1fr)_minmax(0,2.3fr)]"}`}
    >
      <div className={`flex flex-col lg:justify-end lg:pb-2 ${flip ? "lg:order-2" : ""}`}>
        {/* Title and sentence at one size, the sentence in grey: one statement, two weights. */}
        <h2 className="text-xl leading-snug font-semibold tracking-tight text-balance break-keep [overflow-wrap:break-word] text-gray-900 lg:text-[22px] dark:text-gray-100">
          {title}
        </h2>
        <p className="mt-1 text-xl leading-snug text-pretty text-gray-500 lg:text-[22px] dark:text-gray-400">
          {text}
        </p>
        <a
          href={href}
          className="group mt-5 inline-flex w-fit items-center gap-1.5 text-[15px] font-medium text-brand-700 hover:text-brand-600 dark:text-brand-300 dark:hover:text-brand-200"
        >
          {link}
          <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </a>
      </div>
      <LiveAppFrame surface={surface} title={frameTitle} className={flip ? "lg:order-1" : ""} />
    </article>
  );
}

export function Showcase() {
  const { locale } = useLocale();
  const c = S.showcase;
  return (
    <section className="px-4 pt-6 pb-10 sm:px-6 sm:pt-10 sm:pb-16">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 sm:gap-8">
        <Row
          surface="chat-rsi"
          title={c.evolve.title}
          text={c.evolve.text}
          link={c.evolve.link}
          href={`${DOCS_URL}self-improvement`}
          frameTitle={c.evolve.frame}
          flip={false}
        />
        <Row
          surface="benchmark-detail"
          title={c.evaluate.title}
          text={c.evaluate.text}
          link={c.evaluate.link}
          href={`${DOCS_URL}evaluation-center`}
          frameTitle={c.evaluate.frame}
          flip
        />
        <Row
          surface="plugins"
          title={c.toolkits.title}
          text={c.toolkits.text(paperToolkits(locale))}
          link={c.toolkits.link}
          href={`${DOCS_URL}skills`}
          frameTitle={c.toolkits.frame}
          flip={false}
        />
      </div>
    </section>
  );
}
