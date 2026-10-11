const MAX_IMAGE_BYTES = 256 * 1024;
const MAX_IMAGE_DATA_URL_LENGTH = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64;
const signatures = {
  "image/jpeg": (data) => data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff,
  "image/png": (data) => data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (data) => data.length >= 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP"
};

function validateImageDataUrl(value) {
  if (value === "") return null;
  if (typeof value !== "string" || value.length > MAX_IMAGE_DATA_URL_LENGTH) {
    return { error: "Images must be no larger than 256 KB after optimization." };
  }

  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return { error: "Upload a valid JPEG, PNG, or WebP image." };
  const [, contentType, encoded] = match;
  const data = Buffer.from(encoded, "base64");
  if (data.length > MAX_IMAGE_BYTES) return { error: "Images must be no larger than 256 KB after optimization." };
  if (data.toString("base64") !== encoded || !signatures[contentType](data)) {
    return { error: "The image data does not match its file type." };
  }
  return { imageData: value };
}

module.exports = { MAX_IMAGE_BYTES, validateImageDataUrl };
