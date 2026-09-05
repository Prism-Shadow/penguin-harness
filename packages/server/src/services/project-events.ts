/**
 * Everyone who can see a Project, told about an event — in ONE place.
 *
 * The audience is the rule ProjectAccess reads to answer "may this user see the Project":
 * the owner plus the members. Publishing is per user channel and only to a user who has
 * GET /api/events open (`peek`, never `get`): a channel opened here would be one nobody is
 * listening on. The session runtime, the title generator and the sessions route all
 * publish through this, so the audience rule is written once.
 */
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import type { ServerEvent } from "../api/types.js";
import type { Channels } from "../hmr/capabilities.js";
import type { ChannelHub } from "../runtime/channel.js";
import { userChannelKey } from "../http/routes/events.js";
import type { Members, ProjectEvents, Projects } from "../mechanisms/projects.js";

@Component()
export class ProjectNotifier implements ProjectEvents {
  @Use() private readonly projects!: Projects;
  @Use() private readonly members!: Members;
  @Use() private readonly channels!: Channels;

  notifyProjectUsers(projectId: string, event: ServerEvent): void {
    const ownerUserId = this.projects.findById(projectId)?.ownerUserId;
    if (ownerUserId === undefined) return;
    const audience = new Set([ownerUserId, ...this.members.list(projectId).map((m) => m.userId)]);
    const channels = this.channels as ChannelHub;
    for (const userId of audience) {
      channels.peek(userChannelKey(userId))?.publish(event, "server_event");
    }
  }
}
