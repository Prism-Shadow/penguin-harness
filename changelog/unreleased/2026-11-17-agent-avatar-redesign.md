# An Agent's default avatar is a friendlier penguin, and wears something of its own

- **Date:** 2026-11-17
- **Type:** feature
- **Scope:** `ui`, `ui-gallery`

[中文版](2026-11-17-agent-avatar-redesign.zh.md)

The penguin drawn for an Agent with no picture of its own was redrawn: a round chick seen close up, with big eyes, an orange beak, a feather tuft and blushing cheeks, in place of the small ball with a face inside a dark ring. Each Agent's penguin also wears one of eight things, picked by the Agent's id the way its colour is. An Agent's own picture, the tile shapes and the stored data are unchanged.

## Details

- The penguin fills the tile: the ball rests on the tile's bottom edge and the pale face runs down into the belly, so the coat is a hood and two sides. The face is the same at every size; the cheeks blush from 20 px, the eyes carry a catch-light from 24 px and a second one from 48 px.
- The beak is one orange in every colour and in both modes.
- What an Agent wears is one of nothing, a scarf, a beanie, a cap, headphones, a sprout, a bow or glasses. It is the quotient of the id's hash by 360 taken modulo eight, where the colour is the remainder, so every colour meets every accessory. It is painted in the blush of the palette slot opposite the Agent's own.
- The built-in General Agent (`default_agent`) keeps its green and wears nothing.
- The three drawings keep their names and their themes: `flat` on a rounded square (Primer), `soft` on a circle (Frost, Doodle) and `pixel` on a square (Console), where the accessories are drawn cell by cell.
- The UI package exports `AGENT_ACCESSORIES`, `agentAccessory(id)`, `AGENT_BEAK` and `avatarHash(key)`; `AgentColors` gained `beak` and `accent`.
- The gallery's avatars board draws 14, 18, 24, 48 and 96 px, cycles the accessories across its twelve sample Agents, and names each accessory in a row of its own.
