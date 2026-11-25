/**
 * The Project events notifier moved to the projects domain package
 * (@prismshadow/penguin-library-project/events, server restack S11) — it publishes over the
 * package's ProjectChannels port. This file keeps the assembly: the Provider binds the
 * notifier's port to the server's `Channels` hub and re-exports the moved shapes for the
 * server's own import paths.
 */
import { Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { Channels } from "../hmr/capabilities.js";
import type { Members, ProjectEvents, Projects } from "@prismshadow/penguin-library-project";
import { ProjectNotifier } from "@prismshadow/penguin-library-project/events";
import { userChannelKey } from "../http/user-channel.js";

export * from "@prismshadow/penguin-library-project/events";

/** The events assembly: binds the notifier's channels port (the user-channel key mapping is the server's own). */
@Module()
export class ProjectNotifierProvider {
  @Use() private readonly projects!: Projects;
  @Use() private readonly members!: Members;
  @Use() private readonly channels!: Channels;
  @Provide() events!: ProjectEvents;
  @Provide() notifier!: ProjectNotifier;

  setup() {
    this.notifier = Object.assign(new ProjectNotifier(), {
      projects: this.projects,
      members: this.members,
      channels: { peekUser: (userId: string) => this.channels.peek(userChannelKey(userId)) },
    });
    this.events = this.notifier;
  }
}
