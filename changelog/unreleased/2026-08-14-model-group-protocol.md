# Models: use the OpenAI-compatible client when moving to Custom

Moving an existing model to the Custom group now sets `client_type` to `openai`, matching models added directly to that group and preventing unsupported-model errors for custom IDs.

Unknown IDs in first-party groups now offer a one-click move to Custom while preserving the entered settings.
