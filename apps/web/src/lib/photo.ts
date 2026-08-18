/**
 * Getting a photograph small enough to keep.
 *
 * A mortality photograph is worth taking because it settles an argument about
 * what happened and gives a vet something to look at. It is only worth taking
 * if it survives the walk back to signal — which means it has to sit in the
 * outbox next to the round it belongs to.
 *
 * That is the whole problem. The outbox lives in localStorage, which is a
 * handful of megabytes for the entire origin, and a modern phone camera
 * produces four to twelve megabytes per frame. Storing one untouched photograph
 * would exceed the quota on its own; the write would throw, the queue's write
 * would swallow it, and the round the worker just recorded would vanish. A
 * feature that loses the day's data to save a picture is a bad trade.
 *
 * So the image is drawn into a canvas at a bounded size and re-encoded as JPEG
 * before it is ever stored. 900px on the long edge at quality 0.5 lands around
 * 40–90 kB, which is legible enough to show a vet a sick bird and small enough
 * that a ten-stop round with a photograph at every stop still fits.
 *
 * The base64 in a data URL costs about a third again on top, and that is
 * accounted for in the budget above.
 */

/** Long edge, in pixels, after downscaling. */
const MAX_EDGE = 900;

/** JPEG quality. Low enough to be small, high enough to show a carcass. */
const QUALITY = 0.5;

/**
 * Anything above this is refused rather than stored.
 *
 * A guard against a pathological image — a photograph of noise does not
 * compress, and one that came back at a megabyte would still be enough to cost
 * somebody their round.
 */
const MAX_STORED_BYTES = 400_000;

export interface CapturedPhoto {
  /** The original filename, kept so the record can name what was attached. */
  name: string;
  /** JPEG data URL, already downscaled. */
  dataUrl: string;
  /** Approximate stored size in bytes, for showing the worker what it cost. */
  bytes: number;
}

/**
 * Downscale and re-encode a captured image.
 *
 * Returns null when the file cannot be read as an image, or when the result is
 * still too large to be worth the risk. Callers should treat null as "no
 * photograph" and say so, rather than failing the entry — the deaths still need
 * recording whether or not the camera cooperated.
 */
export async function compressPhoto(file: File): Promise<CapturedPhoto | null> {
  if (!file.type.startsWith('image/')) return null;

  const bitmap = await loadImage(file);
  if (!bitmap) return null;

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;

  // White underneath, because a transparent PNG flattened onto nothing becomes
  // black and a black photograph tells you less than no photograph.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  if ('close' in bitmap) bitmap.close();

  const dataUrl = canvas.toDataURL('image/jpeg', QUALITY);
  const bytes = approximateBytes(dataUrl);
  if (bytes > MAX_STORED_BYTES) return null;

  return { name: file.name, dataUrl, bytes };
}

/**
 * `createImageBitmap` where it exists, an <img> everywhere else. Safari on
 * older iOS is common on the handsets this runs on.
 */
async function loadImage(file: File): Promise<ImageBitmap | HTMLImageElement | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      // Fall through to the <img> path rather than giving up.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement | null>((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Size of the payload a data URL will occupy, near enough to warn on. */
function approximateBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Math.round((base64.length * 3) / 4);
}

/** For showing a size to a person. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
