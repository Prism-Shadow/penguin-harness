/**
 * The house style for activity media: what every generated image and spoken narration should
 * look and sound like for young learners. It is applied in two places. The Media Agent's runs
 * hand it to the provider beside the prompt the author saved (images, Gemini speech), and the
 * runs that write those prompts (Improve narration script, improve image prompt) write to it.
 * Edit the rules here; nothing else repeats them.
 */

/** How every generated image is drawn, sent with the image's own description. */
export const IMAGE_STYLE = [
  "A friendly picture for children aged 3 to 8 who are learning to read.",
  "Simple flat illustration: clean outlines, bright but soft colours, gentle shading, a plain or lightly suggested background.",
  "One clear subject, centred and filling most of the square frame, with nothing that pulls the eye away from it.",
  "No words, letters, numbers, labels or captions unless the description asks for them; never draw the asset name. When a letter or word is asked for, draw it large, in plain lowercase school print unless the description says otherwise, spelled exactly as given.",
  "People look warm and approachable and are varied in skin tone, age and ability.",
  "Nothing frightening, violent, unsafe to copy, or branded.",
].join("\n");

/** How Gemini reads a narration aloud. A word pronunciation follows its own direction instead. */
export const NARRATION_DELIVERY =
  "Speak warmly and clearly at an unhurried pace, like a kind teacher reading to young children, and pronounce every word fully.";

/** How a narration's words are written, for the run that improves a spoken script. */
export const NARRATION_WRITING = [
  "Write for children aged 3 to 8 hearing it read aloud: short sentences, everyday words, one instruction at a time.",
  "Keep anything the learner must find, say or tap (a letter, a sound, a word being taught) exactly as the activity teaches it.",
  "Be warm and encouraging; praise effort, never tease, and never make a mistake sound bad.",
].join("\n");
