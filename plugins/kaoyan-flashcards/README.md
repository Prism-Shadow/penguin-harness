# Kaoyan Flashcards

A question bank, spaced review and recitation notes for China's postgraduate entrance exam (kaoyan), in a tab beside your Agent.

## What it does

- Quizzes you on 295 sample questions in six subjects (数学一, 英语一, 思想政治, 计算机 408, 机械设计, 经济学), by whole subject or by chapter, with filters for question type, keyword and scope.
- Schedules every card again after you rate it: **Again** in about ten hours, **Hard** in a day, **Good** after 1, 2, 4, 7, 15, 30 and then 60 days. Wrong answers collect under **Mistakes**; cards can be starred.
- Holds nine short recitation documents. Click paragraphs to mark them, turn on **Hide marked** to blur their key phrases, and click a paragraph to check yourself.
- Imports your own material from .docx, .pdf, .txt or .md files, or pasted text: numbered questions with options and an answer line become quiz cards, everything else becomes a recitation document.
- Shows a daily goal, a streak and your accuracy on the home screen. Formulas render without any external library.
- Speaks Chinese or English: it follows your device's language, and the button in the top bar switches it and remembers your choice. The questions and recitation notes themselves are in Chinese.

## Get started

1. On the Plugins page, install Kaoyan Flashcards onto an Agent. It is not preinstalled on any Agent.
2. Open the Agent's Kaoyan Flashcards tab beside the chat, or its tile in the App Center.
3. Then:
   - Click **Start today's plan** on the home screen. The first subject's cards start.
   - Pick an option, or click **Show answer**, then rate the card **Again**, **Hard** or **Good**. On a keyboard: space shows the answer, 1 / 2 / 3 rate, the arrow keys move between cards.
   - Open **Recite**, click two or three paragraphs to mark them, and turn on **Hide marked**.

## Your data

- Your progress (ratings, review dates, wrong answers, stars, marks, the language you picked, and the cards and documents you import) is kept in the workbench's own state on the server, with this Agent. The browser keeps a copy as a cache, so the same progress shows up in another browser. A single saved item larger than 512 KB, such as a very large imported PDF, stays in the browser where you imported it.
- Nothing is sent to any other host. The page loads no remote script, style or font, and imported files are read inside the browser. Its only requests go to this app's own server: the page, its two data files and your saves.
- **Export study data** in the **Filters and settings** drawer downloads all of it as one JSON file, and **Restore study data** brings such a file back.
- Removing the workbench from the Agent deletes its saves.

## Make it yours

The workbench is source in the Agent's own files (`workbenches/kaoyan-flashcards/`), so the Agent can change it when you ask. The question bank is `ui/data/decks.json`, one card per line, and the recitation documents are `ui/data/docs.json`; the interface text in both languages is `ui/i18n.js`. For example:

- "Add a deck 管理学 with 20 single-choice questions on organisational behaviour, each with a one-line explanation."
- "When I rate a card Good, schedule the next review after 1, 3, 7, 14 and then 30 days."

A plugin update replaces the source, including any change the Agent made to it; your progress stays.

## Licence and credits

Apache-2.0, see [LICENSE](LICENSE). By Prism-Shadow, built from a workbench contributed by the PenguinHarness community, which also supplied the sample questions and recitation notes.
