# Image reading folds into `read_file`; `input_command` shares `exec_command`'s timeout

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `core`, `web`, `cli`, `server`, `docs`

[中文版](2026-09-02-read-file-images.zh.md)

Removed the `read_image` and `describe_image` tools and taught `read_file` to read images: a png/jpeg/gif/webp file (recognized by magic number, then extension) or an http(s) URL in `file_path` comes back as image content when the Session model accepts images, and as the Project's `vision_model` answering a new optional `prompt` argument when it does not — everything the two tools did, behind one name and one schema. `read_file`'s timeout rose to 60000 ms, and `input_command`'s timeout aligned with `exec_command` at 120000 ms.

## Details

- `read_file`'s text behavior is unchanged (numbered window, `offset` / `limit`, scan cap, secret-store refusal). An image ignores `offset` / `limit`; binary content that is no supported image is still rejected with advice; a URL is only ever an image source.
- The branch is decided by the `VisionDescriberService` the SDK injects into the Environment for text-only Sessions only. Absent, the image is returned via `tool_call_output.images` with a one-line `image/png, 123.4 kB` note. Present, the image and `prompt` (default: a detailed description) go to the vision model in one one-off request whose text streams back as the tool output, nothing of that request leaking into the parent stream and the usage bookkeeping unchanged. With no `vision_model` configured the call ends `fatal` with the same explanation as before, asking the model to have the user pick one.
- The shared image loading moved from `read-image.ts` into `environment/tools/image-source.ts`; `read-image.ts` and `describe-image.ts` are gone, with their registry factories and default-config entries. The default toolset is seven tools, none carrying a `forModel` annotation — the per-model-class filter stays a config feature.
- `input_command`'s empty-poll default wait dropped from 120000 ms to 110000 ms, so a default-length poll still returns on its own under the 120000 ms timeout.
- The kernel version advanced to `2026-09-02` (the tools tab moved): the Web App's kernel update writes the new `read_file` entry and drops the two image entries from an unedited tools tab. What an existing Agent sees without it is recorded in [backward compatibility](2026-09-02-backward-compatibility-read-file-images.md).
- Web tool cards preview the `read_image` / `describe_image` calls of old Traces by their `source` argument, the way file tools are previewed by `file_path`. Model-settings copy, the CLI's vision-model help, and the docs name `read_file` as the image reader.
