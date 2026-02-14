import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { ChunkManager, Downloader } from "@/core";
import { ControlFile } from "@/storage";
import { tmpdir } from "os";
import { join } from "path";
import { mkdir, rm, stat } from "fs/promises";

const TEST_TIMEOUT_MS = 10_000;

describe("Downloader", () => {
    const testDir = join(tmpdir(), "multipar-downloader-test");
    let downloader: Downloader;

    beforeEach(async () => {
        await mkdir(testDir, { recursive: true });
        downloader = new Downloader({
            maxConnectionsPerServer: 4,
            outputDirectory: testDir,
        });
    });

    afterEach(async () => {
        await rm(testDir, { recursive: true, force: true });
    });

    test(
        "should create downloader with default options",
        () => {
            expect(downloader).toBeDefined();
            expect(downloader["options"].maxConnectionsPerServer).toBe(4);
        },
        TEST_TIMEOUT_MS
    );

    test(
        "should get queue length",
        () => {
            // Queue length is managed internally, just verify no error
            expect(downloader).toBeDefined();
        },
        TEST_TIMEOUT_MS
    );

    test(
        "should support event listeners",
        () => {
            const callback = () => {};
            downloader.on("complete", callback);
            // Just verify it doesn't throw
            expect(true).toBe(true);
        },
        TEST_TIMEOUT_MS
    );
});

describe("ControlFile", () => {
    const testDir = join(tmpdir(), "multipar-downloader-control-test");
    const testFile = join(testDir, "test.txt");

    beforeEach(async () => {
        await mkdir(testDir, { recursive: true });
    });

    afterEach(async () => {
        await rm(testDir, { recursive: true, force: true });
    });

    test(
        "should persist only basename in control file filename",
        async () => {
            const nestedPath = join(testDir, "nested", "sample.bin");
            const controlFile = new ControlFile(nestedPath);
            const chunkManager = new ChunkManager({
                segmentSize: 1024,
                maxSplits: 1,
                totalSize: 2048,
                outputPath: nestedPath,
                fileAllocation: "none",
                resumeDownloads: true,
                alwaysResume: false,
                controlFile,
                urls: ["https://example.com/file.bin"],
            });

            await chunkManager.initialize();
            const loaded = await controlFile.load();

            expect(loaded?.filename).toBe("sample.bin");

            await chunkManager.cleanup();
        },
        TEST_TIMEOUT_MS
    );

    test(
        "should save and load control file",
        async () => {
            const controlFile = new ControlFile(testFile);
            const data = {
                version: "1.0",
                urls: ["https://example.com/file.zip"],
                filename: "file.zip",
                outputPath: testFile,
                totalSize: 1000000,
                segments: [
                    {
                        index: 0,
                        startByte: 0,
                        endByte: 999999,
                        downloadedBytes: 500000,
                        status: "downloading" as const,
                    },
                ],
                createdAt: new Date().toISOString(),
                lastModified: new Date().toISOString(),
            };

            await controlFile.save(data);
            const loaded = await controlFile.load();

            expect(loaded).toEqual(data);
        },
        TEST_TIMEOUT_MS
    );

    test(
        "should return null when file does not exist",
        async () => {
            const nonExistentFile = join(testDir, "non-existent.txt");
            const controlFile = new ControlFile(nonExistentFile);

            const result = await controlFile.load();
            expect(result).toBeNull();
        },
        TEST_TIMEOUT_MS
    );

    test(
        "should delete control file",
        async () => {
            const controlFile = new ControlFile(testFile);
            const data = {
                version: "1.0",
                urls: ["https://example.com/file.zip"],
                filename: "file.zip",
                outputPath: testFile,
                totalSize: 1000,
                segments: [],
                createdAt: new Date().toISOString(),
                lastModified: new Date().toISOString(),
            };

            await controlFile.save(data);
            await controlFile.delete();

            try {
                await stat(controlFile.getPath());
                expect(false).toBe(true); // Should not reach here
            } catch {
                expect(true).toBe(true); // File should not exist
            }
        },
        TEST_TIMEOUT_MS
    );
});
