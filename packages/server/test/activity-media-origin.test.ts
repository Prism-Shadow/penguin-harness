import { describe, expect, it } from "vitest";
import {
  mediaContentType,
  mediaEtag,
  mediaVersion,
  planMediaResponse,
} from "../src/activities/media-origin.js";

const facts = { size: 1000, mtimeMs: 1_700_000_000_000 };
const etag = mediaEtag(facts);

describe("content types", () => {
  it("names the types a WAF activity actually plays", () => {
    expect(mediaContentType("cat.png")).toBe("image/png");
    expect(mediaContentType("hello.mp3")).toBe("audio/mpeg");
    expect(mediaContentType("intro.mp4")).toBe("video/mp4");
    expect(mediaContentType("art.svg")).toBe("image/svg+xml");
  });

  it("ignores case in the extension", () => {
    expect(mediaContentType("CAT.PNG")).toBe("image/png");
  });

  it("refuses to guess at anything else", () => {
    // A player handed the wrong type fails in ways that look like a broken file.
    expect(mediaContentType("notes.txt")).toBe("application/octet-stream");
    expect(mediaContentType("no-extension")).toBe("application/octet-stream");
    expect(mediaContentType("archive.tar.zst")).toBe("application/octet-stream");
  });
});

describe("the validator", () => {
  it("covers both size and modification time", () => {
    expect(mediaEtag({ size: 10, mtimeMs: 20 })).not.toBe(mediaEtag({ size: 11, mtimeMs: 20 }));
    expect(mediaEtag({ size: 10, mtimeMs: 20 })).not.toBe(mediaEtag({ size: 10, mtimeMs: 21 }));
  });

  it("is stable for the same file", () => {
    expect(mediaEtag(facts)).toBe(mediaEtag({ ...facts }));
  });
});

describe("a whole-file request", () => {
  const plan = planMediaResponse("cat.png", facts, {});

  it("is a 200 with the file's length", () => {
    expect(plan.status).toBe(200);
    expect(plan.headers["Content-Length"]).toBe("1000");
    expect(plan.range).toBeNull();
  });

  it("advertises ranges, so a player knows it may seek", () => {
    expect(plan.headers["Accept-Ranges"]).toBe("bytes");
  });

  it("is revalidated, because a draft's media changes under the same path", () => {
    expect(plan.headers["Cache-Control"]).toBe("private, no-cache");
    expect(plan.headers["X-Content-Type-Options"]).toBe("nosniff");
  });
});

describe("a versioned request", () => {
  it("names the file's own bytes, so a replaced file gets a new version", () => {
    expect(mediaVersion(facts)).toBe(mediaVersion({ ...facts }));
    expect(mediaVersion(facts)).not.toBe(mediaVersion({ ...facts, size: facts.size + 1 }));
    expect(mediaVersion(facts)).not.toBe(mediaVersion({ ...facts, mtimeMs: facts.mtimeMs + 1 }));
  });

  it("is cached for good when its version matches the file", () => {
    const plan = planMediaResponse("cat.png", facts, { version: mediaVersion(facts) });
    expect(plan.headers["Cache-Control"]).toBe("private, max-age=31536000, immutable");
  });

  it("stays on the 304 too, so a revalidated copy keeps its lifetime", () => {
    const plan = planMediaResponse("cat.png", facts, {
      version: mediaVersion(facts),
      ifNoneMatch: mediaEtag(facts),
    });
    expect(plan.status).toBe(304);
    expect(plan.headers["Cache-Control"]).toBe("private, max-age=31536000, immutable");
  });

  it("is revalidated when its version names other bytes", () => {
    for (const version of ["stale-1", "manual", ""]) {
      const plan = planMediaResponse("cat.png", facts, { version });
      expect(plan.headers["Cache-Control"]).toBe("private, no-cache");
    }
  });
});

describe("a range request", () => {
  it("answers 206 with agreeing Content-Range and Content-Length", () => {
    const plan = planMediaResponse("intro.mp4", facts, { range: "bytes=100-199" });
    expect(plan.status).toBe(206);
    expect(plan.headers["Content-Range"]).toBe("bytes 100-199/1000");
    // The pair has to agree; a disagreement is a bug no happy-path test would find.
    expect(plan.headers["Content-Length"]).toBe("100");
    expect(plan.range).toEqual({ start: 100, end: 199, length: 100 });
  });

  it("serves an open-ended range to the end", () => {
    const plan = planMediaResponse("intro.mp4", facts, { range: "bytes=990-" });
    expect(plan.headers["Content-Range"]).toBe("bytes 990-999/1000");
    expect(plan.headers["Content-Length"]).toBe("10");
  });

  it("serves a suffix range as the last bytes", () => {
    const plan = planMediaResponse("intro.mp4", facts, { range: "bytes=-10" });
    expect(plan.headers["Content-Range"]).toBe("bytes 990-999/1000");
  });

  it("answers 416 with the file's size when the range is outside it", () => {
    const plan = planMediaResponse("intro.mp4", facts, { range: "bytes=5000-6000" });
    expect(plan.status).toBe(416);
    expect(plan.headers["Content-Range"]).toBe("bytes */1000");
    expect(plan.range).toBeNull();
    // No Content-Length for a range that cannot be served.
    expect(plan.headers["Content-Length"]).toBeUndefined();
  });

  it("falls back to the whole file when If-Range no longer matches", () => {
    const plan = planMediaResponse("intro.mp4", facts, {
      range: "bytes=100-199",
      ifRange: '"stale-validator"',
    });
    expect(plan.status).toBe(200);
    expect(plan.headers["Content-Length"]).toBe("1000");
  });

  it("honours a range when If-Range still matches", () => {
    const plan = planMediaResponse("intro.mp4", facts, {
      range: "bytes=100-199",
      ifRange: etag,
    });
    expect(plan.status).toBe(206);
  });
});

describe("a conditional request", () => {
  it("answers 304 when the client already has this exact file", () => {
    const plan = planMediaResponse("cat.png", facts, { ifNoneMatch: etag });
    expect(plan.status).toBe(304);
    expect(plan.range).toBeNull();
    expect(plan.headers["Content-Length"]).toBeUndefined();
  });

  it("sends the file when the validator moved on", () => {
    const plan = planMediaResponse("cat.png", facts, { ifNoneMatch: '"something-else"' });
    expect(plan.status).toBe(200);
  });

  it("prefers 304 over a range, since the client has the bytes already", () => {
    const plan = planMediaResponse("intro.mp4", facts, {
      ifNoneMatch: etag,
      range: "bytes=0-9",
    });
    expect(plan.status).toBe(304);
  });
});

describe("an empty file", () => {
  it("serves it as a 200 of length zero", () => {
    const plan = planMediaResponse("empty.mp3", { size: 0, mtimeMs: 1 }, {});
    expect(plan.status).toBe(200);
    expect(plan.headers["Content-Length"]).toBe("0");
  });

  it("refuses a range against it rather than pretending", () => {
    const plan = planMediaResponse("empty.mp3", { size: 0, mtimeMs: 1 }, { range: "bytes=0-0" });
    expect(plan.status).toBe(416);
    expect(plan.headers["Content-Range"]).toBe("bytes */0");
  });
});
