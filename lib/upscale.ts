// Client-side canvas upscaling — enlarges a JPEG/PNG data URL by the given
// integer factor using the browser's highest-quality bicubic resampler.
// Used to improve tile resolution for low-resolution orthophotos before
// alignment and change detection.
export async function upscaleImage(dataUrl: string, factor: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * factor);
      canvas.height = Math.round(img.naturalHeight * factor);
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.92));
    };
    img.onerror = () => reject(new Error("Failed to upscale image"));
    img.src = dataUrl;
  });
}
