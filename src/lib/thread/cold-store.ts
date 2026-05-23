/**
 * Pluggable cold-tier interface for thread archives.
 *
 * Zeitlich's thread manager is a Redis-backed hot tier optimized for
 * the duration of a workflow run. A `ColdThreadStore` provides the
 * durable archive: each thread is serialized to a single
 * {@link ThreadSnapshot} blob (messages + persisted state slice +
 * dedup-id ledger) at session-exit time, and restored at session-entry
 * time when the workflow is resumed or forked.
 *
 * The contract is intentionally minimal — one read, one write, one
 * delete keyed by `(threadKey, threadId)`. Any storage backend that
 * can satisfy these three calls (S3, R2, GCS, Postgres, the local
 * filesystem, etc.) can plug into the same tiered manager.
 *
 * Concurrency assumption: zeitlich assumes a single active session
 * per `(threadKey, threadId)` at a time, so cold writes are
 * last-writer-wins; no compare-and-swap is required.
 */

import { gunzip as gunzipCb, gzip as gzipCb } from "node:zlib";
import { promisify } from "node:util";
import type { PersistedThreadState } from "../state/types";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

// Async zlib so gzip/gunzip yield to the event loop, letting activity
// heartbeats fire on schedule during compression of large snapshots.
const gzipAsync = promisify(gzipCb);
const gunzipAsync = promisify(gunzipCb);

/**
 * Serialized form of a thread that can be written to and read from a
 * {@link ColdThreadStore}.
 *
 * `messages` is the list of raw-serialized message strings exactly as
 * they were stored in the Redis list — keeping the cold tier opaque
 * to the adapter-specific message envelope. `state` is the
 * {@link PersistedThreadState} that the session writes via
 * `saveThreadState` on every exit path, or `null` if none has been
 * written yet. `dedupIds` lets the tiered manager re-prime the
 * idempotent-append dedup markers when restoring, so a rewind retry
 * after a continue cannot accidentally re-append a message.
 */
export interface ThreadSnapshot {
  v: 1;
  messages: string[];
  state: PersistedThreadState | null;
  dedupIds: string[];
}

/** Pluggable cold archive for thread snapshots. */
export interface ColdThreadStore {
  /**
   * Read the latest snapshot for `(threadKey, threadId)`, or return
   * `null` if no snapshot has ever been written.
   */
  read(
    threadKey: string,
    threadId: string
  ): Promise<ThreadSnapshot | null>;
  /**
   * Persist `snapshot` as the latest archive for `(threadKey,
   * threadId)`. Overwrites any prior snapshot in place.
   */
  write(
    threadKey: string,
    threadId: string,
    snapshot: ThreadSnapshot
  ): Promise<void>;
  /**
   * Permanently remove the archive for `(threadKey, threadId)`.
   * No-op if no snapshot exists.
   */
  delete(threadKey: string, threadId: string): Promise<void>;
}

/**
 * Compact, duck-typed shape of an S3 client. Zeitlich only needs the
 * `send(...)` method; declaring this locally avoids forcing
 * `@aws-sdk/client-s3` to be installed when the consumer is using a
 * different cold-store backend.
 */
export interface S3LikeClient {
  send<TInput, TOutput>(
    command: { input: TInput } & object
  ): Promise<TOutput>;
}

/** Configuration for the built-in S3 cold store. */
export interface S3ColdStoreConfig {
  /** An `@aws-sdk/client-s3` `S3Client` (or duck-typed equivalent). */
  s3: S3LikeClient;
  /** S3 bucket that holds the archive. */
  bucket: string;
  /**
   * Optional key prefix applied to every object. The final key layout
   * is `${prefix}/${threadKey}/${threadId}.json[.gz]` with leading
   * slashes stripped. Defaults to `"threads"`.
   */
  prefix?: string;
  /**
   * Gzip the JSON payload before uploading and assume gzip on read.
   * Defaults to `true` — message lists are highly compressible.
   */
  gzip?: boolean;
  /**
   * Optional `Content-Type` override. Defaults to
   * `application/json` (or `application/gzip` when `gzip: true`).
   */
  contentType?: string;
}

function joinKey(parts: string[]): string {
  return parts
    .map((p) => p.replace(/^\/+|\/+$/g, ""))
    .filter((p) => p.length > 0)
    .join("/");
}

function buildKey(
  prefix: string | undefined,
  threadKey: string,
  threadId: string,
  gzip: boolean
): string {
  const ext = gzip ? "json.gz" : "json";
  return joinKey([
    prefix ?? "threads",
    threadKey,
    `${threadId}.${ext}`,
  ]);
}

async function streamToBuffer(
  body: unknown
): Promise<Buffer> {
  if (body == null) return Buffer.alloc(0);
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof (body as { transformToByteArray?: () => Promise<Uint8Array> })
    .transformToByteArray === "function") {
    const bytes = await (
      body as { transformToByteArray: () => Promise<Uint8Array> }
    ).transformToByteArray();
    return Buffer.from(bytes);
  }
  if (typeof (body as { arrayBuffer?: () => Promise<ArrayBuffer> })
    .arrayBuffer === "function") {
    const ab = await (
      body as { arrayBuffer: () => Promise<ArrayBuffer> }
    ).arrayBuffer();
    return Buffer.from(ab);
  }
  // Node.js Readable stream fallback
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer | Uint8Array>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Build an S3-backed {@link ColdThreadStore}.
 *
 * One object per thread at
 * `${prefix}/${threadKey}/${threadId}.json[.gz]`, JSON-encoded and
 * gzip-compressed by default. The consumer owns the `S3Client`
 * instance, so credentials, region, and endpoint configuration live
 * outside zeitlich.
 *
 * @example
 * ```typescript
 * import { S3Client } from "@aws-sdk/client-s3";
 * import { createS3ColdStore } from "zeitlich";
 *
 * const coldStore = createS3ColdStore({
 *   s3: new S3Client({ region: "us-east-1" }),
 *   bucket: "my-threads",
 *   prefix: "prod/threads",
 * });
 * ```
 */
export function createS3ColdStore(
  config: S3ColdStoreConfig
): ColdThreadStore {
  const { s3, bucket, prefix, gzip = true } = config;
  const contentType =
    config.contentType ?? (gzip ? "application/gzip" : "application/json");

  return {
    async read(
      threadKey: string,
      threadId: string
    ): Promise<ThreadSnapshot | null> {
      const Key = buildKey(prefix, threadKey, threadId, gzip);

      try {
        const resp = (await s3.send(
          new GetObjectCommand({ Bucket: bucket, Key })
        )) as { Body?: unknown };
        const buf = await streamToBuffer(resp.Body);
        const json = gzip
          ? (await gunzipAsync(buf)).toString("utf8")
          : buf.toString("utf8");
        return JSON.parse(json) as ThreadSnapshot;
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },

    async write(
      threadKey: string,
      threadId: string,
      snapshot: ThreadSnapshot
    ): Promise<void> {
      const Key = buildKey(prefix, threadKey, threadId, gzip);
      const json = JSON.stringify(snapshot);
      const body = gzip ? await gzipAsync(Buffer.from(json, "utf8")) : json;

      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key,
          Body: body,
          ContentType: contentType,
        })
      );
    },

    async delete(
      threadKey: string,
      threadId: string
    ): Promise<void> {
      const Key = buildKey(prefix, threadKey, threadId, gzip);

      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key }));
    },
  };
}

function isNotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as {
    name?: string;
    Code?: string;
    code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    e.name === "NoSuchKey" ||
    e.Code === "NoSuchKey" ||
    e.code === "NoSuchKey" ||
    e.name === "NotFound" ||
    e.$metadata?.httpStatusCode === 404
  );
}
