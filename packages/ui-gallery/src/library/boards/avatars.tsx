/** 头像: the user avatar at its two rungs, with and without a nickname, and the agent avatar at three sizes. */
import { AgentAvatar } from "../../../../web/src/components/ui/agent-avatar";
import { USER_AVATAR_SIZE, UserAvatar } from "../../../../web/src/components/ui/user-avatar";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";

export function AvatarsBoard() {
  const { S } = useGallery();
  const t = S.library.avatars;
  const [userId, displayName] = t.userNames;
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
    </div>
  );
}
