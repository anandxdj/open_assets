// Decoding a data URL into pixels, shared by the rig editor (alpha lookups for
// mesh building) and the renderer (the source bitmap it warps).
export interface Raster {
  image: HTMLImageElement;
  /** RGBA, row-major. Alpha lives at `(y * width + x) * 4 + 3`. */
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export function loadImageElement(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("That image could not be decoded."));
    image.src = dataUrl;
  });
}

export async function loadRaster(dataUrl: string): Promise<Raster> {
  const image = await loadImageElement(dataUrl);
  const width = image.naturalWidth;
  const height = image.naturalHeight;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This browser refused a 2D canvas.");
  ctx.drawImage(image, 0, 0);

  return { image, data: ctx.getImageData(0, 0, width, height).data, width, height };
}
