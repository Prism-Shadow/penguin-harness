/** The models page. */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { ModelsPage } from "./models-page";

@Module({
  contributes: {
    "WebAppModule.pages": [
      {
        id: "models.page",
        key: "models",
        path: "/models",
        frame: "shell",
        nav: "main",
        admin: false,
        released: true,
        order: 30,
      },
    ],
  },
})
export class ModelsModule {
  @Bind("models.page") page = ModelsPage;
}
