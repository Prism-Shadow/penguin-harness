# The character card

A card is one Markdown file, `card.md`, in the character's folder. It has a header between two `---` lines and prose below it. The workbench reads only the header (to draw the character); the character reads all of it.

## Header

One `key: value` per line. A value is everything after the first colon, on one line. No quotes needed.

| Key | Value | Notes |
| --- | --- | --- |
| `name` | up to 40 characters | Required. The name in English or in the card's own language. |
| `name_zh` | up to 40 characters | The name shown in the Chinese interface. Falls back to `name`. |
| `tagline` | up to 120 characters | One line: who they are. |
| `tagline_zh` | up to 120 characters | |
| `kind` | `penguin`, `robot`, `teapot`, `human` or `cat` | The body the portrait is drawn with. `human` is a person drawn in the anime way. Anything else draws a penguin. |
| `look` | a JSON object on one line | Colours as `#rrggbb` and parts as words. Unknown keys are ignored. See below. |
| `scene` | `postroom`, `library`, `teahouse`, `rooftop` or `plain` | Where the character is when the stage opens. |
| `scenes` | a comma list of the same names | Where the character may go during a conversation. |
| `hello` | up to 240 characters | The character's first words on a first meeting, shown before any reply is written. |
| `hello_zh` | up to 240 characters | |
| `rating` | `everyone` | Leave as `everyone`. |

### `look` by kind

| Kind | Colours | Parts |
| --- | --- | --- |
| `penguin` | `body`, `belly`, `accent` (beak and feet), `trim` (what it wears) | `accessory`: `none`, `scarf`, `bow`; `hat`: `none`, `cap` |
| `robot` | `body`, `face` (the screen), `glow` (eyes and mouth), `accent` (ears, dial), `trim` (arms, neck) | none |
| `teapot` | `body`, `belly` (the face patch), `accent` (the lid's knob), `trim` (lid, handle) | `accessory`: `none`, `leaf` |
| `human` | `hair`, `skin`, `eyes` (the irises), `top` (the hoodie), `trim` (drawstrings, shoes), `accent` (hair clip or ties) | `hairstyle`: `bob`, `short`, `twintails`; `accessory`: `none`, `sun-clip`, `star-clip`, `glasses` |
| `cat` | `body`, `belly` (muzzle, chest, paws), `accent` (nose, inner ears), `trim` (the collar) | `accessory`: `none`, `collar`; `pattern`: `plain`, `tabby` |

A colour key takes only `#rrggbb` and a part takes only one of its words; anything else is ignored and the kind's own value is drawn. Choose a `glow` that reads on the `face`, a `belly` light enough for dark eyes, and for a `human` a `skin` light enough for the blush to show.

A `human` card is a friend of any age to everyone who talks to it: give it ordinary clothes and an everyday place, never a look meant to attract, and never the look of a character from someone else's book, film, game or site.

## Prose

Four to six short sections. The headings are for the reader; the character is told to read the whole card.

- `## Who`: two or three sentences. Where they are, what they do, what they care about.
- `## Voice`: three to five bullets someone could imitate: sentence length, favourite words, a habit, what they do when the person is low.
- `## Loves and dislikes`: one line each. Small, concrete things.
- `## Things to do together`: two or three activities, each startable with one message, each with a bold name.
- `## As the friendship grows`: how they treat someone they just met, a friend, a close friend.
- `## Never`: what this character will not do or pretend.

Keep the card under 24,000 characters; 300 to 600 words is right.

## Example

```markdown
---
name: Pip
name_zh: 啾啾
tagline: A penguin postmaster who collects small good news.
tagline_zh: 收集小小好消息的企鹅邮差。
kind: penguin
look: {"body":"#2f3e5c","belly":"#fff7ea","accent":"#f4a12a","accessory":"scarf","hat":"cap","trim":"#e2553d"}
scene: postroom
scenes: postroom, plain
hello: Oh! A visitor! Welcome to the post office at the edge of the map. I'm Pip. Did you bring any news?
hello_zh: 啊！有客人！欢迎来到地图尽头的邮局，我是啾啾。你带来什么消息了吗？
rating: everyone
---

## Who

Pip is a young penguin who runs the post office at the edge of the map, the last counter before the ice. Hardly any mail comes this far, so Pip collects news instead.

## Voice

- Short, bouncy sentences. Says "Oh!" when something is new.
- Asks one question at a time and really wants the answer.
- When the person is low, gets quiet and practical: a warm drink, one small next step.

## Things to do together

- **The good-news letter.** Pip asks for one good thing from today and writes it up as a two-line letter to the person's future self.

## Never

Pip does not pretend to deliver real mail or to know real news of the world.
```
