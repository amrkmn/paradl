import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Downloader } from "@/core";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { mkdir, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const TEST_TIMEOUT_MS = 10_000;
const TEST_DIR = join(tmpdir(), `paradl-integration-${Date.now()}`);
const PAYLOAD = Buffer.from("paradl payload ".repeat(1024), "utf-8");
const DEBUG_TESTS = process.env.PARADL_TEST_DEBUG === "1";

function debugLog(message: string): void {
    if (DEBUG_TESTS) {
        console.log(`[paradl:test] ${message}`);
    }
}

async function waitWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    onTimeout: () => void
): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            debugLog(`timeout after ${timeoutMs}ms; cancelling task`);
            onTimeout();
            reject(new Error(`Test timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        promise.then(
            value => {
                clearTimeout(timer);
                resolve(value);
            },
            error => {
                clearTimeout(timer);
                reject(error);
            }
        );
    });
}

function parseRange(rangeHeader: string, size: number): { start: number; end: number } | null {
    const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
    if (!match) return null;

    const start = Number.parseInt(match[1], 10);
    const end = match[2] ? Number.parseInt(match[2], 10) : size - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= size) return null;
    return { start, end };
}

describe("Downloader integration", () => {
    let server: ReturnType<typeof createServer>;
    let baseUrl = "";

    beforeAll(async () => {
        debugLog(`creating test dir: ${TEST_DIR}`);
        await mkdir(TEST_DIR, { recursive: true });

        server = createServer((req: IncomingMessage, res: ServerResponse) => {
            debugLog(`server request: ${req.method ?? "UNKNOWN"} ${req.url ?? ""}`);
            const rangeHeader = req.headers.range;

            if (req.method === "HEAD") {
                if (rangeHeader) {
                    res.writeHead(206, {
                        "Content-Length": "1",
                        "Content-Range": `bytes 0-0/${PAYLOAD.length}`,
                        "Accept-Ranges": "bytes",
                    });
                    res.end();
                    return;
                }

                res.writeHead(200, {
                    "Content-Length": PAYLOAD.length,
                    "Accept-Ranges": "bytes",
                });
                res.end();
                return;
            }

            if (req.method === "GET") {
                if (!rangeHeader) {
                    res.writeHead(200, {
                        "Content-Length": PAYLOAD.length,
                        "Accept-Ranges": "bytes",
                    });
                    res.end(PAYLOAD);
                    return;
                }

                const range = parseRange(rangeHeader, PAYLOAD.length);
                if (!range) {
                    res.writeHead(416);
                    res.end();
                    return;
                }

                const chunk = PAYLOAD.subarray(range.start, range.end + 1);
                res.writeHead(206, {
                    "Content-Length": chunk.length,
                    "Content-Range": `bytes ${range.start}-${range.end}/${PAYLOAD.length}`,
                    "Accept-Ranges": "bytes",
                });
                res.end(chunk);
                return;
            }

            res.writeHead(405);
            res.end();
        });

        await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
        const address = server.address();
        if (!address || typeof address === "string") {
            throw new Error("Failed to start test server");
        }
        baseUrl = `http://127.0.0.1:${address.port}`;
        debugLog(`server listening at ${baseUrl}`);
    });

    afterAll(async () => {
        debugLog("teardown start");
        if (server?.listening) {
            server.closeIdleConnections?.();
            server.closeAllConnections?.();
            await Promise.race([
                new Promise<void>(resolve => server.close(() => resolve())),
                new Promise<void>(resolve => setTimeout(resolve, 2000)),
            ]);
        }
        await rm(TEST_DIR, { recursive: true, force: true });
        debugLog("teardown complete");
    });

    test(
        "downloads a file successfully",
        async () => {
            const downloader = new Downloader({
                outputDirectory: TEST_DIR,
                maxConnectionsPerServer: 2,
                segmentSize: "64KB",
                retries: 0,
                timeout: 3000,
            });
            downloader.on("start", () => debugLog("download start"));
            downloader.on("progress", (_info, progress) => {
                debugLog(
                    `progress ${progress.downloadedBytes}/${progress.totalBytes} (${progress.percent.toFixed(1)}%)`
                );
            });
            downloader.on("error", (_info, error) => debugLog(`download error: ${error.message}`));
            downloader.on("complete", () => debugLog("download complete"));

            const filename = "sample.bin";
            debugLog(`starting download ${baseUrl}/file.bin`);
            const task = await downloader.download({
                urls: [`${baseUrl}/file.bin`],
                filename,
                outputDir: TEST_DIR,
            });
            const completionPromise = (task as typeof task & { completionPromise: Promise<void> })
                .completionPromise;
            await waitWithTimeout(completionPromise, TEST_TIMEOUT_MS - 1000, () => task.cancel());

            const filePath = join(TEST_DIR, filename);
            const content = await readFile(filePath);
            expect(content.equals(PAYLOAD)).toBe(true);
        },
        TEST_TIMEOUT_MS
    );
});
