/**
 * The 32x32 gate.
 *
 * ⚠ Tested against REAL image headers, not a mocked reader. The whole reason this
 * middleware exists is that nothing else in the upload pipeline knows a picture's
 * dimensions — `file-type` reads magic bytes and stops — so a test that stubbed the
 * dimension read would be asserting the one thing that is not in doubt.
 */
import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { requireMaxDimensions } from "./imageDimensions.js";
import { NodevoError } from "@nodevo/errors";

/** A real PNG header: 8-byte signature + an IHDR carrying width and height. */
function png(width: number, height: number): Buffer {
  const sig  = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4);
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8;   // bit depth
  ihdr[17] = 6;   // colour type (RGBA)
  return Buffer.concat([sig, ihdr]);
}

function run(buffer: Buffer | null) {
  const next = vi.fn();
  const req = { file: buffer ? { buffer } : undefined } as unknown as Request;
  requireMaxDimensions(32, 32)(req, {} as Response, next);
  return next;
}

describe("requireMaxDimensions", () => {
  it("passes an image at the limit", () => {
    expect(run(png(32, 32))).toHaveBeenCalledWith();
  });

  /** ⚠ A MAXIMUM, not an exact match — a 16x16 badge is a fine badge. */
  it("passes an image below the limit", () => {
    expect(run(png(16, 16))).toHaveBeenCalledWith();
  });

  it("refuses an image that is too wide", () => {
    const err = run(png(64, 32)).mock.calls[0]![0] as any;
    expect(err).toBeInstanceOf(NodevoError);
    expect(err.code).toBe("NEC-STORE-7005");
    expect(err.httpStatus).toBe(422);
  });

  it("refuses an image that is too tall", () => {
    expect(run(png(32, 64)).mock.calls[0]![0] as any).toBeInstanceOf(NodevoError);
  });

  /**
   * ⚠ The numbers travel in `details`, not only in the message: the API is
   * locale-agnostic (§60), so the frontend words the sentence the admin reads.
   */
  it("reports both the actual size and the limit", () => {
    const err = run(png(200, 100)).mock.calls[0]![0] as any;
    expect(err.details).toEqual({ width: 200, height: 100, maxWidth: 32, maxHeight: 32 });
  });

  /** Detected as an image by magic bytes, but the header will not parse. */
  it("refuses a buffer whose dimensions cannot be read", () => {
    const err = run(Buffer.from("not an image at all")).mock.calls[0]![0] as any;
    expect(err).toBeInstanceOf(NodevoError);
  });

  /** No file is `uploadSingle`'s error to raise, not this one's. */
  it("passes through when there is no file", () => {
    expect(run(null)).toHaveBeenCalledWith();
  });
});
