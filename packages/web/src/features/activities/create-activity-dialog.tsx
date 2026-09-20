import { useState } from "react";
import type { ActivityDetail } from "@prismshadow/penguin-server/api";
import { apiFetch } from "../../api/client";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { Select } from "../../components/ui/select";

/** Loom-style create dialog: the fields an activity starts with, nothing more. */
export function CreateActivityDialog({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string;
  onClose: () => void;
  onCreated: (activityId: string) => void;
}) {
  const [productCode, setProductCode] = useState("");
  const [refNum, setRefNum] = useState("");
  const [title, setTitle] = useState("");
  const [activityType, setActivityType] = useState("standard");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError("");
    try {
      const result = await apiFetch<ActivityDetail>(
        `/api/projects/${encodeURIComponent(projectId)}/activities`,
        {
          method: "POST",
          body: { productCode, refNum: Number(refNum), title, activityType },
        },
      );
      setProductCode("");
      setRefNum("");
      setTitle("");
      onCreated(result.id);
    } catch (e) {
      setError(apiErrorText(e));
    } finally {
      setCreating(false);
    }
  }
  return (
    <Modal
      open
      title={S.activities.create}
      onClose={onClose}
      footer={
        <>
          <Button size="sm" onClick={onClose} disabled={creating}>
            {S.common.cancel}
          </Button>
          <Button
            size="sm"
            variant="primary"
            type="submit"
            form="create-activity"
            disabled={creating}
          >
            {creating ? S.activities.busy : S.activities.create}
          </Button>
        </>
      }
    >
      <form id="create-activity" onSubmit={(event) => void create(event)} className="space-y-3">
        <Input
          size="sm"
          label={S.activities.productCode}
          value={productCode}
          onChange={(e) => setProductCode(e.target.value)}
          required
          maxLength={100}
          disabled={creating}
        />
        <Input
          size="sm"
          label={S.activities.refNum}
          type="number"
          min={0}
          step={1}
          value={refNum}
          onChange={(e) => setRefNum(e.target.value)}
          required
          disabled={creating}
        />
        <Input
          size="sm"
          label={S.activities.name}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={200}
          disabled={creating}
        />
        <Select
          size="sm"
          label={S.activities.type}
          value={activityType}
          onChange={(e) => setActivityType(e.target.value)}
          disabled={creating}
        >
          <option value="standard">{S.activities.standard}</option>
          <option value="book">{S.activities.book}</option>
        </Select>
        {error && (
          <p role="alert" className={`text-xs ${toneInk.danger}`}>
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
