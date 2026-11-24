/**
 * The Task Manager page's web half: its page, contributed through the app's `WebAppModule.pages`
 * slot as a system app of the system Agent (a tile in the App Center), drawn only while the
 * plugin's server module (`TaskManagerModule` on the server, src/server/module.ts) runs — an
 * administrator can stop it, and a server whose Projects all left it out does not run it.
 *
 * Its copy is its own (strings.ts).
 */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { TaskManagerPage } from "./task-manager-page";

@Module({
  contributes: {
    "WebAppModule.serverModules": [{ id: "task-manager.server", module: "TaskManagerModule" }],
    "WebAppModule.pages": [
      {
        id: "task-manager.page",
        key: "tasks",
        path: "/tasks",
        frame: "shell",
        nav: "none",
        admin: false,
        released: true,
        // After the Cost Center (60) and the Evaluation Center's page.
        order: 70,
        title: "Task Manager",
        titleZh: "任务管理器",
        icon: "pulse",
        app: { order: 60 },
      },
    ],
  },
})
export class TaskManagerWebModule {
  @Bind("task-manager.page") page = TaskManagerPage;
}
