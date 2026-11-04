/** Audio in a conversation: the `audio` file renderer a server's file renderer rule may name (audio-file.tsx). */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { AudioFile } from "./audio-file";

@Module({
  contributes: {
    "ChatModule.fileRenderers": [{ id: "audio.file", name: "audio" }],
  },
})
export class AudioModule {
  @Bind("audio.file") file = AudioFile;
}
