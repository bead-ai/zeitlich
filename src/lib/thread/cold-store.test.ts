import { describe, expect, it, beforeEach } from "vitest";
import { gunzipSync, gzipSync } from "node:zlib";
import { createS3ColdStore, type S3LikeClient } from "./cold-store";
import type { ThreadSnapshot } from "./cold-store";

interface StoredObject {
  body: Buffer;
  contentType?: string;
}

interface CommandInput {
  Bucket: string;
  Key: string;
  Body?: Buffer | string;
  ContentType?: string;
}

/**
 * Minimal S3-shaped fake. `send()` dispatches by command constructor
 * name; `config` provides the fields `@aws-sdk/lib-storage`'s
 * single-part upload path inspects.
 */
function createFakeS3(): {
  s3: S3LikeClient;
  store: Map<string, StoredObject>;
  calls: { get: number; put: number; delete: number };
} {
  const store = new Map<string, StoredObject>();
  const calls = { get: 0, put: 0, delete: 0 };

  const compositeKey = (bucket: string, key: string): string =>
    `${bucket}/${key}`;

  const s3 = {
    config: {
      requestHandler: undefined,
      forcePathStyle: false,
      endpoint: async (): Promise<URL> => new URL("https://fake.s3.local"),
    },
    async send<TInput, TOutput>(
      command: { input: TInput } & object
    ): Promise<TOutput> {
      const name = (command as { constructor: { name: string } }).constructor
        .name;
      const input = command.input as unknown as CommandInput;
      const fullKey = compositeKey(input.Bucket, input.Key);
      if (name === "GetObjectCommand") {
        calls.get++;
        const obj = store.get(fullKey);
        if (!obj) {
          const err = new Error("NoSuchKey") as Error & { name: string };
          err.name = "NoSuchKey";
          throw err;
        }
        return { Body: obj.body } as unknown as TOutput;
      }
      if (name === "PutObjectCommand") {
        calls.put++;
        const body =
          typeof input.Body === "string"
            ? Buffer.from(input.Body, "utf8")
            : (input.Body as Buffer);
        store.set(fullKey, {
          body,
          ...(input.ContentType && { contentType: input.ContentType }),
        });
        return {} as TOutput;
      }
      if (name === "DeleteObjectCommand") {
        calls.delete++;
        store.delete(fullKey);
        return {} as TOutput;
      }
      throw new Error(`unknown command: ${name}`);
    },
  } as unknown as S3LikeClient;

  return { s3, store, calls };
}

const sampleSnapshot: ThreadSnapshot = {
  v: 1,
  messages: [JSON.stringify({ id: "m1", text: "hi" })],
  state: null,
  dedupIds: ["m1"],
};

describe("createS3ColdStore", () => {
  let fake: ReturnType<typeof createFakeS3>;

  beforeEach(() => {
    fake = createFakeS3();
  });

  it("read returns null when no object exists for the thread", async () => {
    const cold = createS3ColdStore({
      s3: fake.s3,
      bucket: "test-bucket",
    });
    expect(await cold.read("messages", "t-1")).toBeNull();
  });

  it("write then read round-trips a snapshot (gzip default)", async () => {
    const cold = createS3ColdStore({
      s3: fake.s3,
      bucket: "test-bucket",
      prefix: "prod/threads",
    });
    await cold.write("messages", "t-1", sampleSnapshot);
    expect(await cold.read("messages", "t-1")).toEqual(sampleSnapshot);

    // Verify the on-disk format is gzip + JSON.
    const stored = fake.store.get("test-bucket/prod/threads/messages/t-1.json.gz");
    expect(stored).toBeDefined();
    if (!stored) throw new Error("expected stored object");
    expect(stored.contentType).toBe("application/gzip");
    const decoded = JSON.parse(gunzipSync(stored.body).toString("utf8"));
    expect(decoded).toEqual(sampleSnapshot);
  });

  it("supports plain JSON when gzip is disabled", async () => {
    const cold = createS3ColdStore({
      s3: fake.s3,
      bucket: "test-bucket",
      gzip: false,
    });
    await cold.write("messages", "t-1", sampleSnapshot);

    const stored = fake.store.get("test-bucket/threads/messages/t-1.json");
    expect(stored).toBeDefined();
    if (!stored) throw new Error("expected stored object");
    expect(stored.contentType).toBe("application/json");
    expect(JSON.parse(stored.body.toString("utf8"))).toEqual(sampleSnapshot);

    expect(await cold.read("messages", "t-1")).toEqual(sampleSnapshot);
  });

  it("uses 'threads' as the default prefix", async () => {
    const cold = createS3ColdStore({
      s3: fake.s3,
      bucket: "test-bucket",
    });
    await cold.write("messages", "abc", sampleSnapshot);
    expect(fake.store.has("test-bucket/threads/messages/abc.json.gz")).toBe(true);
  });

  it("delete removes the underlying object", async () => {
    const cold = createS3ColdStore({
      s3: fake.s3,
      bucket: "test-bucket",
    });
    await cold.write("messages", "t-1", sampleSnapshot);
    await cold.delete("messages", "t-1");
    expect(await cold.read("messages", "t-1")).toBeNull();
    expect(fake.store.size).toBe(0);
  });

  it("read treats 404 errors as null (not throw)", async () => {
    const cold = createS3ColdStore({
      s3: {
        async send() {
          const err = {
            name: "NotFound",
            $metadata: { httpStatusCode: 404 },
          };
          throw err;
        },
      } as unknown as S3LikeClient,
      bucket: "test-bucket",
    });
    expect(await cold.read("messages", "t-1")).toBeNull();
  });

  it("read rethrows non-404 errors", async () => {
    const cold = createS3ColdStore({
      s3: {
        async send() {
          throw new Error("AccessDenied");
        },
      } as unknown as S3LikeClient,
      bucket: "test-bucket",
    });
    await expect(cold.read("messages", "t-1")).rejects.toThrow("AccessDenied");
  });

  it("falls back to gunzip when the cold object is gzip-encoded but read with gzip:true", async () => {
    // Pre-seed the fake S3 with a gzip-encoded payload, then read.
    const compressed = gzipSync(Buffer.from(JSON.stringify(sampleSnapshot)));
    fake.store.set("test-bucket/threads/messages/t-1.json.gz", {
      body: compressed,
    });
    const cold = createS3ColdStore({
      s3: fake.s3,
      bucket: "test-bucket",
    });
    expect(await cold.read("messages", "t-1")).toEqual(sampleSnapshot);
  });

  it("round-trips a large payload through the async gzip path", async () => {
    // ~1 MB payload — regression guard that large payloads still
    // encode/decode correctly through the promisified gzip path.
    const big: ThreadSnapshot = {
      v: 1,
      messages: Array.from({ length: 500 }, (_, i) =>
        JSON.stringify({
          id: `m${i}`,
          text: "x".repeat(2048),
        })
      ),
      state: null,
      dedupIds: Array.from({ length: 500 }, (_, i) => `m${i}`),
    };

    const cold = createS3ColdStore({
      s3: fake.s3,
      bucket: "test-bucket",
    });
    await cold.write("messages", "big", big);
    expect(await cold.read("messages", "big")).toEqual(big);
  });
});
