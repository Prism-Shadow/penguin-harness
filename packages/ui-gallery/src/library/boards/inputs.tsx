/** 输入与表单: Input, Textarea and PasswordInput on the shared field scaffolding, with hint, info and error. */
import { useState } from "react";
import { Input, Textarea } from "../../../../web/src/components/ui/input";
import { PasswordInput } from "../../../../web/src/components/ui/password-input";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";

export function InputsBoard() {
  const { S } = useGallery();
  const t = S.library.inputs;
  const [name, setName] = useState("");
  const [email, setEmail] = useState(t.emailValue);
  const [prompt, setPrompt] = useState("");
  const [params, setParams] = useState(t.monoValue);
  const [password, setPassword] = useState("");
  return (
    <div className="gf-board">
      <BoardGroup title={t.basics}>
        <div className="lib-stack">
          <Input
            label={t.name}
            hint={t.nameHint}
            placeholder={t.namePlaceholder}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Input
            label={t.email}
            type="email"
            error={t.emailError}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Input label={t.required} required placeholder={t.required} />
          <Input
            label={t.info}
            info={t.infoText}
            infoLabel={t.info}
            id="lib-input-info"
            placeholder={t.info}
          />
        </div>
      </BoardGroup>
      <BoardGroup title={t.sizes}>
        <div className="lib-stack">
          <Input label={t.base} size="base" placeholder={t.base} />
          <Input label={t.small} size="sm" placeholder={t.small} />
        </div>
      </BoardGroup>
      <BoardGroup title={t.textarea}>
        <div className="lib-stack">
          <Textarea
            label={t.textarea}
            placeholder={t.textareaPlaceholder}
            rows={3}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
          <Textarea
            label={t.mono}
            mono
            rows={3}
            value={params}
            onChange={(event) => setParams(event.target.value)}
          />
        </div>
      </BoardGroup>
      <BoardGroup title={t.password}>
        <div className="lib-stack">
          <PasswordInput
            label={t.password}
            hint={t.passwordHint}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
      </BoardGroup>
    </div>
  );
}
