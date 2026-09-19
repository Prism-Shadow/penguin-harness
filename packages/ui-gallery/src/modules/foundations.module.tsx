/**
 * The Foundations module: the vocabulary every other module is built from, one board per variant.
 * It lives in the gallery rather than in `packages/ui/src/modules/` because its boards are gallery
 * machinery — the Icons board reads the Web App's source, the Colour board the accent presets in
 * theme.css — and the Hooks board applies all six hooks outside any host component.
 */
import { defineModule } from "../../../ui/src/module";
import { ColourBoard } from "../foundations/color";
import { SpacingBoard } from "../foundations/density";
import { FocusBoard } from "../foundations/focus";
import { HooksBoard } from "../foundations/hooks";
import { IconsBoard } from "../foundations/icons";
import { MotionBoard } from "../foundations/motion";
import { ShapeBoard } from "../foundations/shape";
import { TypeBoard } from "../foundations/typography";

const BOARDS = {
  colour: ColourBoard,
  type: TypeBoard,
  "shape-depth": ShapeBoard,
  spacing: SpacingBoard,
  icons: IconsBoard,
  motion: MotionBoard,
  focus: FocusBoard,
  hooks: HooksBoard,
} as const;

export const module = defineModule({
  id: "foundations",
  title: "Foundations",
  description:
    "The palette, the type scale, shape and depth, the rhythm steps, icons, motion, focus and the six style hooks, each on a board.",
  width: "wide",
  variants: [
    { key: "colour", title: "Colour" },
    { key: "type", title: "Type" },
    { key: "shape-depth", title: "Shape & depth" },
    { key: "spacing", title: "Spacing" },
    { key: "icons", title: "Icons" },
    { key: "motion", title: "Motion" },
    { key: "focus", title: "Focus" },
    { key: "hooks", title: "Hooks" },
  ],
  parts: ["icons-glyph-icon", "icons-registry", "icons-marks"],
  render: (variant) => {
    const Board = BOARDS[variant as keyof typeof BOARDS] ?? ColourBoard;
    return <Board />;
  },
});
