import { describe, expect, it } from "vitest";
import { gitEnv } from "../src/activities/deploy-git.js";

describe("the environment git runs in", () => {
  it("never prompts, and runs SSH in batch mode by default", () => {
    const env = gitEnv({ PATH: "/bin" });
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(env.GIT_SSH_COMMAND).toBe("ssh -o BatchMode=yes");
    expect(env.PATH).toBe("/bin");
  });

  it("keeps the operator's own SSH setup", () => {
    const own = "ssh -i /keys/deploy -o BatchMode=yes";
    expect(gitEnv({ GIT_SSH_COMMAND: own }).GIT_SSH_COMMAND).toBe(own);
    const wrapper = gitEnv({ GIT_SSH: "/usr/local/bin/ssh-wrapper" });
    expect(wrapper.GIT_SSH).toBe("/usr/local/bin/ssh-wrapper");
    expect(wrapper.GIT_SSH_COMMAND).toBeUndefined();
  });
});
