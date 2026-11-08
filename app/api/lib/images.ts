import sharp from "sharp";
export async function sanitizeImage(bytes: Buffer) {
  // Reject other decoder families before passing untrusted data to native libraries.
  const png = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp =
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP";
  if (!png && !jpeg && !webp) throw new Error("Unsupported image signature");
  const image = sharp(bytes, {
    limitInputPixels: 16000000,
    animated: false,
    failOn: "warning",
  });
  const metadata = await image.metadata();
  if (
    !["jpeg", "png", "webp"].includes(metadata.format ?? "") ||
    (metadata.pages ?? 1) > 1
  )
    throw new Error("Unsupported image");
  return image
    .rotate()
    .resize({
      width: 2400,
      height: 2400,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 85 })
    .toBuffer();
}
