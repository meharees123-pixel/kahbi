const test = require("node:test");
const assert = require("node:assert/strict");
const { MAX_IMAGE_BYTES, validateImageDataUrl } = require("../src/images");

const validJpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0x00]).toString("base64")}`;

test("image validation accepts base64 JPEG and explicit image removal", () => {
  assert.deepEqual(validateImageDataUrl(validJpeg), { imageData: validJpeg });
  assert.equal(validateImageDataUrl(""), null);
});

test("image validation rejects unsupported, malformed, and mislabeled data", () => {
  assert.match(validateImageDataUrl("data:image/svg+xml;base64,PHN2Zz4=").error, /JPEG, PNG, or WebP/);
  assert.match(validateImageDataUrl("data:image/jpeg;base64,not-base64!").error, /valid JPEG/);
  assert.match(validateImageDataUrl("data:image/png;base64,/9j/").error, /does not match/);
});

test("image validation enforces the decoded 256 KB size limit", () => {
  const data = Buffer.alloc(MAX_IMAGE_BYTES + 1, 0);
  const oversized = `data:image/jpeg;base64,${data.toString("base64")}`;
  assert.match(validateImageDataUrl(oversized).error, /256 KB/);
});
