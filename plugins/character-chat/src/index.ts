import { Component } from "@prismshadow/penguin-core/plugin";
import type { Plugin } from "@prismshadow/penguin-core/plugin";

/**
 * Everything this plugin carries, declared for the plugin library. Data only: the class has no
 * body and the package no entry point; `build` writes this literal into `ifaces.json`.
 */
@Component({
  contributes: {
    "PluginLibraryModule.cards": [
      {
        id: "character-chat.card",
        title: "AI Character Chat",
        titleZh: "AI 角色对话",
        descriptionZh:
          "AI 角色对话：角色有表情、有场景，会记住你们聊过的事，友谊随天数加深。自带四个原创角色，也可以自己写角色卡，或让 Agent 替你写。Skill 让 Agent 在普通对话里也能用角色的口吻说话和做事。",
        shortDescription: "Chat with characters who have a face.",
        shortDescriptionZh: "和有表情、有记忆的角色聊天。",
        // TODO: `learning-life` once the category exists (https://github.com/Prism-Shadow/penguin-harness/pull/1580).
        category: "office-productivity",
        icon: "icon.svg",
        // Installed from the library on demand: no Agent gets it at creation.
        preinstall: false,
        quickStart: {
          prompt:
            "Write a new character card for the Characters workbench: a retired lighthouse keeper who answers every question with a sea story. Tell me when to open the Characters tab.",
          promptZh:
            "给「角色」工作台写一张新的角色卡：一位退休的灯塔看守人，回答任何问题都要先讲一段海上的故事。写好后告诉我打开「角色」标签页。",
          skills: ["character-chat"],
        },
      },
    ],
    "PluginLibraryModule.skills": [
      {
        id: "character-chat.skill.character-chat",
        name: "character-chat",
        path: "skills/character-chat",
      },
    ],
    "PluginLibraryModule.workbenches": [
      {
        id: "character-chat.workbench.characters",
        name: "characters",
        path: "workbenches/characters",
      },
    ],
  },
})
export class CharacterChatPlugin {}

export default { modules: [CharacterChatPlugin] } satisfies Plugin;
