import { describe, expect, it } from "vitest";
import { checkPhotoFile, MAX_PHOTO_BYTES } from "./photo-rules";

describe("checkPhotoFile", () => {
  it("accepts allowed types within the size limit", () => {
    expect(checkPhotoFile({ type: "image/png", size: 1000 })).toBeNull();
    expect(checkPhotoFile({ type: "image/webp", size: MAX_PHOTO_BYTES })).toBeNull();
  });

  it("rejects other types", () => {
    expect(checkPhotoFile({ type: "image/gif", size: 10 })).toBe("Photo must be a JPEG, PNG, or WebP image");
  });

  it("rejects empty and oversized files", () => {
    expect(checkPhotoFile({ type: "image/jpeg", size: 0 })).toBe("Photo file is empty");
    expect(checkPhotoFile({ type: "image/jpeg", size: MAX_PHOTO_BYTES + 1 })).toBe("Photo must be 4 MB or smaller");
  });
});
