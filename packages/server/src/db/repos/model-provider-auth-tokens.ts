/**
 * Server-side OAuth refresh metadata for provider groups.
 *
 * The user-visible credential remains the ordinary model `api_key` in .project_config.toml.
 * This table stores only refresh material and expiry metadata that must stay on the server:
 * never return it through model APIs and never write it into Project files.
 */
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import type { Db } from "../../hmr/capabilities.js";
import type { ModelProviderAuthToken, ModelProviderAuthTokens } from "../../mechanisms/projects.js";

@Component()
export class ModelProviderAuthTokensRepo implements ModelProviderAuthTokens {
  @Use() private readonly db!: Db;

  get(projectId: string, provider: string): ModelProviderAuthToken | undefined {
    const row = this.db
      .prepare(
        `SELECT provider, refresh_token, access_token_expires_at, updated_at
         FROM model_provider_auth_tokens
         WHERE project_id = ? AND provider = ?`,
      )
      .get(projectId, provider);
    if (!row) return undefined;
    return {
      provider: row.provider as string,
      refreshToken: row.refresh_token as string,
      ...(typeof row.access_token_expires_at === "string"
        ? { accessTokenExpiresAt: row.access_token_expires_at }
        : {}),
      updatedAt: row.updated_at as string,
    };
  }

  upsert(projectId: string, row: Omit<ModelProviderAuthToken, "updatedAt">): void {
    this.db
      .prepare(
        `INSERT INTO model_provider_auth_tokens
           (project_id, provider, refresh_token, access_token_expires_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(project_id, provider) DO UPDATE SET
           refresh_token = excluded.refresh_token,
           access_token_expires_at = excluded.access_token_expires_at,
           updated_at = excluded.updated_at`,
      )
      .run(
        projectId,
        row.provider,
        row.refreshToken,
        row.accessTokenExpiresAt ?? null,
        new Date().toISOString(),
      );
  }

  delete(projectId: string, provider: string): void {
    this.db
      .prepare("DELETE FROM model_provider_auth_tokens WHERE project_id = ? AND provider = ?")
      .run(projectId, provider);
  }
}
