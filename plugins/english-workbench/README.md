# English Learning Workbench

A daily English desk beside your Agent: read classics aloud word by word, keep the words you meet, and review them.

## What it does

- Read three public-domain classics (Pride and Prejudice, A Scandal in Bohemia, Frankenstein) sentence by sentence: click a sentence to hear it, click a word for its note, slow it down, or record yourself reading after it.
- Paste any English article, a news story or a WeChat post, and read it the same way. The bundled news and TED picks come with annotated words, a summary or description and a discussion question; their full text stays on the publisher's site.
- Keep a library of words and sentences, with a spaced review quiz (again after 1, 2, 4, 7 and 15 days) and a 30-day activity map.
- Follow a 15, 30 or 45 minute daily plan at one of four levels, and practise short IELTS, TOEFL, CET and Kaoyan tasks with model answers.
- Optionally, list today's headlines from a fixed set of public news feeds. This is off until you switch it on.
- Speaks Chinese or English: the interface follows your device's language, and the button in the top bar (or Settings → Interface language) switches it and remembers your choice. The study material stays as written: the English passages, and the Chinese meanings, translations and notes that come with them.

## Get started

1. On the Plugins page, install English Learning Workbench onto an Agent. It is built in, but not preinstalled on any Agent.
2. Open that Agent. The **English Learning Workbench** tab appears beside the chat; you can also open its tile in the App Center.
3. Then:
   - on **Today**, pick how long you have today (15, 30 or 45 min);
   - open **Classics** → Pride and Prejudice, click a sentence to hear it and a word to see its note;
   - click **Add to library** on a word or two, then go to **My library** → **Review** to try the review quiz.

## Your data

Your progress (settings, saved words and sentences, notes, answers and pasted articles) is kept as one document in the workbench's own state on your PenguinHarness server. The page keeps no copy of it in the browser, so opening the workbench from another browser shows the same record. **Settings** → **Data** exports it as a JSON file. The interface language you pick is the one thing the browser remembers, under its own key, and it holds only "zh" or "en".

By default the workbench sends nothing over the internet. Everything that does is your choice:

- **Daily press, when you switch it on.** The server reads the RSS feeds at feeds.npr.org, feeds.a.dj.com, www.latimes.com, www.wired.com, www.smithsonianmag.com, www.sciencedaily.com and www.nature.com when you open the press page and the list is more than 20 minutes old, or when you click refresh. It identifies itself as `PenguinHarness-EnglishWorkbench/1.0`. Your browser then loads cover images straight from the addresses those feeds give, without sending a referrer. Switch it off and the page keeps the last list, without covers, and nothing more is fetched.
- **Links you click** open the publisher's site in a new tab.
- **Read-aloud** uses your browser's voices. The page prefers voices that run on your device; when a browser has only cloud voices for English, the browser sends the text being read to that voice service.
- **Shadowing (recording yourself)** uses the microphone only when you click, and the recording stays in the page until you reload it.

Removing the workbench deletes its saved record.

## Make it yours

The workbench is source code in the Agent's own files, so the Agent can change it when you ask. For example:

- "Add a fourth book to Classics: two passages from the public-domain text of Jane Eyre, with annotated words and Chinese renderings, in the same shape as the other books."
- "Add five CET-6 translation items about Chinese festivals to Exam practice, each with a model answer and three expressions worth reusing."

Where things are, under `workbenches/english/ui/`: `content.js` holds the study material (books, news and TED picks, exam tasks, lists of videos, WeChat accounts and resources, the daily plans), `app.js` the page, `i18n.js` the interface text in both languages, and `styles.css` the look. The handler in `workbenches/english/index.ts` keeps the record and, when switched on, reads the press feeds.

Updating the plugin replaces this source with the new version, your Agent's edits included.

## Licence and credits

- Apache-2.0, see [LICENSE](LICENSE).
- By Prism-Shadow, built from a workbench contributed by a PenguinHarness user.
- Book excerpts: Jane Austen, _Pride and Prejudice_ (1813); Arthur Conan Doyle, _A Scandal in Bohemia_ (1891); Mary Shelley, _Frankenstein_ (1818). Public domain. The page links each book to its full text at Project Gutenberg; this workbench is not affiliated with Project Gutenberg.
- The Chinese renderings, word notes, summaries, questions and model answers were written for this workbench.
- News, TED, video, WeChat account and resource entries are titles and links to their owners' sites, with descriptions written for this workbench. The names belong to their owners, and listing them implies no endorsement.
- The icon and the illustrations are drawn as SVG in the page itself; the page uses the system's fonts.
