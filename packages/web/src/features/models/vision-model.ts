/**
 * Choosing the Project's vision model from outside the models page: the model that reads images
 * for a model without vision, which image understanding (`penguin tools i2t`) also runs on.
 *
 * The server keeps it in the model table, whose only write is the whole table (PUT /models), so
 * the table is read and written back unchanged around the new pointer — each row through the
 * same conversion the models page saves it with.
 */
import type { ModelRefDto, ModelsResponse } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { rowToEntry, toRow } from "./models-page";

export async function putVisionModel(
  projectId: string,
  model: ModelRefDto,
): Promise<ModelsResponse> {
  const table = await api.getModels(projectId, null);
  return api.putModels(projectId, {
    models: table.models.map((m) => rowToEntry(toRow(m), table.providers[m.provider])),
    visionModel: model,
  });
}
