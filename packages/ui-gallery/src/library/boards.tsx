/**
 * The board each topic renders inside its frame: the component boards (src/library/boards/*)
 * and the Foundations boards (src/foundations/*). One entry per topic id; a test checks the
 * registry covers every topic.
 */
import type { ComponentType } from "react";
import { ColourBoard } from "../foundations/color";
import { SpacingBoard } from "../foundations/density";
import { FocusBoard } from "../foundations/focus";
import { HooksBoard } from "../foundations/hooks";
import { IconsBoard } from "../foundations/icons";
import { MotionBoard } from "../foundations/motion";
import { ShapeBoard } from "../foundations/shape";
import { TypeBoard } from "../foundations/typography";
import { AvatarsBoard } from "./boards/avatars";
import { BadgesBoard } from "./boards/badges";
import { ButtonsBoard } from "./boards/buttons";
import { ChartsBoard } from "./boards/charts";
import { ContentBoard } from "./boards/content";
import { DataBoard } from "./boards/data";
import { DialogsBoard } from "./boards/dialogs";
import { EmptyBoard } from "./boards/empty";
import { FilesBoard } from "./boards/files";
import { InputsBoard } from "./boards/inputs";
import { LayoutBoard } from "./boards/layout";
import { LoadingBoard } from "./boards/loading";
import { NoticesBoard } from "./boards/notices";
import { PickersBoard } from "./boards/pickers";
import { TabsBoard } from "./boards/tabs";
import { ToastsBoard } from "./boards/toasts";
import { TooltipsBoard } from "./boards/tooltips";
import type { TopicId } from "./topics";

export const BOARDS: Readonly<Record<TopicId, ComponentType>> = {
  buttons: ButtonsBoard,
  inputs: InputsBoard,
  pickers: PickersBoard,
  toasts: ToastsBoard,
  notices: NoticesBoard,
  dialogs: DialogsBoard,
  tooltips: TooltipsBoard,
  tabs: TabsBoard,
  badges: BadgesBoard,
  empty: EmptyBoard,
  loading: LoadingBoard,
  charts: ChartsBoard,
  avatars: AvatarsBoard,
  files: FilesBoard,
  content: ContentBoard,
  layout: LayoutBoard,
  data: DataBoard,
  colour: ColourBoard,
  type: TypeBoard,
  shape: ShapeBoard,
  density: SpacingBoard,
  focus: FocusBoard,
  motion: MotionBoard,
  icons: IconsBoard,
  hooks: HooksBoard,
};
