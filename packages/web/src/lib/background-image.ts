/** Bounds wallpaper decoding and storage without uploading the selected file. */
export const BACKGROUND_FILE_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const BACKGROUND_MAX_BYTES = 20 * 1024 * 1024;
const MAX_EDGE = 2560;
const MAX_DATA_CHARS = 1024 * 1024;

export async function backgroundImageFromFile(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image canvas unavailable");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL("image/webp", 0.85);
    if (data.length > MAX_DATA_CHARS) throw new Error("Image exceeds local storage budget");
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}
