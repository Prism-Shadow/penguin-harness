# An Agent's default avatar is a small kawaii penguin, and wears something of its own

- **Date:** 2026-11-17
- **Type:** feature
- **Scope:** `ui`, `ui-gallery`
- **PR:** [#1577](https://github.com/Prism-Shadow/penguin-harness/pull/1577)

[中文版](2026-11-17-agent-avatar-redesign.zh.md)

The penguin drawn for an Agent with no picture of its own was redrawn in the manner of stationery-shop character goods: a whole egg-shaped penguin with flippers at its sides and two orange feet, a cream face, tiny eyes set low and wide, a small orange beak and a curl of a feather on top, drawn with one thin brown line. It replaces the small ball with a face inside a dark ring. Each Agent's penguin also wears one of eight things, picked by the Agent's id the way its colour is. An Agent's own picture, the tile shapes and the stored data are unchanged.

## Details

- The colours are brighter. In dark mode the body is a pastel of the Agent's hue on the deep tile; in light mode it is the lightest tone of that hue that still keeps 3:1 against the pale tile and every theme's page. The face, the eyes and the cheeks are the same in both modes.
- The face is the same at every size, and the smaller the avatar, the larger the features: true size from 40 px, a step larger from 24 px, and larger again below 24 px, where the line is also heavier and drawn in the eyes' darker brown so the face still reads at 14 px. The cheeks blush from 20 px.
- The beak and the feet are one orange, and the line is one brown, in every colour and in both modes.
- What an Agent wears is one of nothing, a scarf, a beanie, a cap, headphones, a sprout, a bow or glasses. It is the quotient of the id's hash by 360 taken modulo eight, where the colour is the remainder, so every colour meets every accessory. It is painted in the body colour of the palette slot opposite the Agent's own and edged by the same brown line.
- The built-in General Agent (`default_agent`) keeps its green and wears nothing.
- The three drawings keep their names and their themes: `flat` on a rounded square (Primer), `soft` on a circle (Frost, Doodle) and `pixel` on a square (Console), where the penguin, its outline and the accessories are drawn cell by cell on a 16 × 16 grid; below 16 px, where the grid is scaled, its eyes are a cell wider.
- The UI package exports `AGENT_ACCESSORIES`, `agentAccessory(id)`, `AGENT_BEAK`, `AGENT_LINE` and `avatarHash(key)`; `AgentColors` gained `beak`, `line` and `accent`.
- The gallery's avatars board draws 14, 18, 24, 48 and 96 px, cycles the accessories across its twelve sample Agents, and names each accessory in a row of its own.
