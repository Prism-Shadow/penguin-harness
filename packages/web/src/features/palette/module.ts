/** The app's command palette, mounted once beside every page. */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { AppPalette } from "./app-palette";

@Module({
  contributes: {
    "WebAppModule.layers": [{ id: "palette.layer", order: 40 }],
  },
})
export class PaletteModule {
  @Bind("palette.layer") layer = AppPalette;
}
