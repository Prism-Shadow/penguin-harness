// After a failed chat, the form is editable again. A return from native model
// settings restores the person's new draft while the failed Session still has the old one.
export function conversationDraft(draft, guide) {
  const editing = guide.phase === "chat-error";
  const sameModel =
    draft.model?.provider === guide.model.provider && draft.model?.modelId === guide.model.modelId;
  return {
    ...draft,
    request: editing ? (draft.request ?? guide.request) : guide.request,
    model: (editing || sameModel) && draft.model ? draft.model : guide.model,
  };
}
