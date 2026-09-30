/**
 * 头像: the user avatar at its two rungs, with and without a nickname, the agent avatar at three
 * sizes, and the avatar stack — agents and an account overlapping, then the count of the rest.
 */
import {
  AgentAvatar,
  AvatarStack,
  ICON_SIZE,
  USER_AVATAR_SIZE,
  UserAvatar,
} from "@prismshadow/penguin-ui";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";

export function AvatarsBoard() {
  const { S } = useGallery();
  const t = S.library.avatars;
  const [userId, displayName] = t.userNames;
  const stack = [
    { id: userId ?? "admin", name: displayName ?? userId ?? "admin", kind: "user" as const },
    ...t.agents.map((agent) => ({ id: agent.id, name: agent.name })),
  ];
  return (
    <div className="gf-board">
      <BoardGroup title={t.user}>
        <div className="lib-row">
          <span className="lib-cell">
            <UserAvatar userId={userId ?? "admin"} />
            <span className="lib-caption">{userId}</span>
          </span>
          <span className="lib-cell">
            <UserAvatar userId={userId ?? "admin"} displayName={displayName} />
            <span className="lib-caption">{displayName}</span>
          </span>
          <span className="lib-cell">
            <UserAvatar
              userId={userId ?? "admin"}
              displayName={displayName}
              size={USER_AVATAR_SIZE.preview}
            />
            <span className="lib-caption">{USER_AVATAR_SIZE.preview}px</span>
          </span>
        </div>
      </BoardGroup>
      <BoardGroup title={t.agent}>
        <div className="lib-row">
          {t.agents.map((agent) => (
            <span key={agent.id} className="lib-cell">
              <AgentAvatar id={agent.id} name={agent.name} />
              <span className="lib-caption">{agent.name}</span>
            </span>
          ))}
          {[24, 32].map((size) => (
            <span key={size} className="lib-cell">
              <AgentAvatar id={t.agents[0]?.id ?? "agent"} name={t.agents[0]?.name} size={size} />
              <span className="lib-caption">{size}px</span>
            </span>
          ))}
        </div>
      </BoardGroup>
      <BoardGroup title={t.stack}>
        <div className="lib-row">
          <span className="lib-cell">
            <AvatarStack items={stack.slice(0, 3)} size={ICON_SIZE.groupHeaderAvatar} />
            <span className="lib-caption">{t.stackShown(3, 3)}</span>
          </span>
          <span className="lib-cell">
            <AvatarStack items={stack} size={ICON_SIZE.groupHeaderAvatar} />
            <span className="lib-caption">{t.stackShown(3, stack.length)}</span>
          </span>
          <span className="lib-cell">
            <AvatarStack items={stack} max={2} size={ICON_SIZE.rowLead} />
            <span className="lib-caption">{t.stackShown(2, stack.length)}</span>
          </span>
        </div>
      </BoardGroup>
    </div>
  );
}
