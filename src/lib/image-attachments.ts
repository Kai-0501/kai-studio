export type ImageAttachment = {
  id: string;
  name: string;
  dataUrl: string;
};

export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function imagePayload(images: ImageAttachment[]) {
  return images.map((image) => image.dataUrl.split(",", 2)[1]).filter(Boolean);
}

export async function filesToImageAttachments(
  files: FileList | File[],
  existingCount = 0,
) {
  const candidates = Array.from(files);
  const availableSlots = Math.max(0, MAX_IMAGES - existingCount);

  if (candidates.length > availableSlots) {
    throw new Error(`You can attach up to ${MAX_IMAGES} photos at a time.`);
  }

  const invalidType = candidates.find(
    (file) => !ACCEPTED_IMAGE_TYPES.includes(file.type),
  );
  if (invalidType) {
    throw new Error("Use a JPG, PNG, or WebP image.");
  }

  const oversized = candidates.find((file) => file.size > MAX_IMAGE_BYTES);
  if (oversized) {
    throw new Error(`${oversized.name} is larger than 10 MB.`);
  }

  return Promise.all(
    candidates.map(
      (file) =>
        new Promise<ImageAttachment>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () =>
            resolve({
              id: crypto.randomUUID(),
              name: file.name,
              dataUrl: String(reader.result),
            });
          reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
          reader.readAsDataURL(file);
        }),
    ),
  );
}
