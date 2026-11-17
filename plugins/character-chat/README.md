# AI Character Chat

Talk with characters that have a face, a place and a memory.

## What it does

Open **Characters** beside an Agent’s chat or choose **AI Character Chat** in the App Center. Pick a portrait from the roster to open the conversation. You can scroll back while a reply arrives, choose a suggested topic or write your own message.

Sunny watches the clouds from a rooftop weather station. Pip, a penguin postmaster, collects good news for tomorrow’s mail. Ren keeps riddles in the books at his night desk. Mugi brews tea for visitors on the mountain road.

Each character keeps a **memory book**: what it has learned about you, one line at a time. You can read it, remove a line, or clear it. A friendship meter grows with the days you talk, not with how much you type, and a character speaks to a friend differently than to someone it just met.

You can write characters of your own in the card editor (name, body, colours, place, first words, and a page of prose about who they are), or describe one and let the Agent write the card. A body is a penguin, a robot, a teapot spirit, a cat or a person drawn in the anime way, each with ten faces. A card can be downloaded as a `.card.md` file and imported again, on this Agent or another.

The `character-chat` Skill lets the Agent speak as a character in the ordinary chat too, where it still does real work with its tools and tells you about it in the character's voice.

## Get started

1. Install the plugin on an Agent from the plugin library.
2. Open the **Characters** tab, or the tile in the App Center.
3. Choose a character and type a message or pick an opening topic.

## Your data

Characters and their memory books are files in the Agent's own folder (`agent_state/workbenches/characters/.files/`). Nothing leaves the server. Anyone who can open the Agent can read them. Removing the workbench deletes them; export the Agent with the workbench's data to keep a copy.

Characters are played by an AI and say so when asked. They are friends, not partners: no romance by design. They are for company and fun, not advice. A character's conversation runs in a Session that only talks: every tool call in it is denied, so neither a line nor an imported card can make it run anything.

## Make it yours

Ask the Agent in the ordinary chat: "Write a character card for a retired lighthouse keeper who answers everything with a sea story." It writes the file and the character appears in the roster.

## Licence

Apache-2.0. The four original portraits and their backgrounds ship with the plugin. The page animates the eyes, mouth and breathing locally. Custom looks use the editable SVG rig.
