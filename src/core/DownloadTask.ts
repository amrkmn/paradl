import { mergeOptions, parseSegmentSize } from "@/config";
import { ChunkManager } from "@/core";
import { HttpClient } from "@/network";
import { ControlFile } from "@/storage";
import { DownloadTaskEventName } from "@/types";
import type {
    DownloaderOptions,
    DownloadOptions,
    DownloadTaskEventMap,
    DownloadTaskInfo,
    Segment,
} from "@/types";
import { TypedEventEmitter } from "@/utils/TypedEventEmitter";
import { extractFilename, calculateSpeed, toError } from "@/utils/common";
import {
    PROGRESS_UPDATE_MIN_INTERVAL_MS,
    PROGRESS_UPDATE_MIN_PERCENT_DELTA,
} from "@/utils/constants";
import PQueue from "p-queue";

export class DownloadTask extends TypedEventEmitter<DownloadTaskEventMap> {
    public id: string;
    public info: DownloadTaskInfo;
    public completionPromise?: Promise<void>; // Exposed for external access

    private options: Required<DownloaderOptions>;
    private httpClient: HttpClient;
    private chunkManager: ChunkManager | null = null;
    private queue: PQueue;
    private abortController: AbortController;
    private startTime: number = 0;
    private speedSamples: number[] = [];
    private isPaused = false;
    private isCancelled = false;
    private lastProgressEmit = 0;
    private lastProgressValue = 0;
    private autoSaveTimer: ReturnType<typeof setInterval> | null = null;
    private autoSaveInFlight = false;

    constructor(options: DownloaderOptions, id: string) {
        super();
        this.options = mergeOptions(options);
        this.id = id;
        this.abortController = new AbortController();

        this.queue = new PQueue({ concurrency: this.options.maxConnectionsPerServer });

        this.httpClient = new HttpClient({
            timeout: this.options.timeout,
            retries: this.options.retries,
            headers: this.options.headers,
            onRedirect: (fromUrl, toUrl) => {
                this.emit(DownloadTaskEventName.Redirect, this.info, fromUrl, toUrl);
            },
        });

        this.info = {
            id,
            urls: [],
            filename: "",
            outputPath: "",
            totalSize: 0,
            segments: [],
            status: "pending",
            progress: {
                totalBytes: 0,
                downloadedBytes: 0,
                percent: 0,
                speed: 0,
                eta: 0,
            },
        };
    }

    async start(downloadOptions: DownloadOptions): Promise<void> {
        let downloadSucceeded = false;

        try {
            this.info.status = "downloading";
            this.info.startTime = new Date();
            this.startTime = Date.now();

            const urls = Array.isArray(downloadOptions.urls)
                ? downloadOptions.urls
                : [downloadOptions.urls];
            this.info.urls = urls;

            const mainUrl = urls[0];
            if (!mainUrl) throw new Error("No URLs provided");

            this.info.totalSize = await this.httpClient.getFileSize(
                mainUrl,
                this.abortController.signal
            );

            if (!this.info.totalSize || this.info.totalSize <= 0)
                throw new Error(`Unable to determine file size for ${mainUrl}`);

            this.info.filename = downloadOptions.filename || extractFilename(mainUrl);
            this.info.outputPath = downloadOptions.outputDir
                ? `${downloadOptions.outputDir}/${this.info.filename}`
                : `${this.options.outputDirectory}/${this.info.filename}`;

            const segmentSize = parseSegmentSize(this.options.segmentSize);
            const controlFile = new ControlFile(this.info.outputPath);

            this.chunkManager = new ChunkManager({
                segmentSize,
                maxSplits: this.options.split,
                totalSize: this.info.totalSize,
                outputPath: this.info.outputPath,
                fileAllocation: this.options.fileAllocation,
                resumeDownloads: this.options.resumeDownloads,
                alwaysResume: this.options.alwaysResume,
                controlFile,
                urls: this.info.urls,
            });

            await this.chunkManager.initialize();
            this.info.segments = this.chunkManager.getSegments();
            this.startAutoSaveLoop();

            this.emit(DownloadTaskEventName.Start, this.info);

            const supportsRange = await this.httpClient.supportsRangeRequests(
                mainUrl,
                this.abortController.signal
            );

            if (!supportsRange) await this.downloadSingleFile(urls[0]);
            else await this.downloadWithSegments(urls);

            downloadSucceeded = true;
        } catch (error) {
            const resolvedError = toError(error, "Download failed");
            this.info.status = "failed";
            this.info.error = resolvedError;
            this.info.endTime = new Date();

            if (this.chunkManager && this.options.resumeDownloads)
                await this.chunkManager.saveProgress();

            this.emit(DownloadTaskEventName.Error, this.info, resolvedError);
            throw resolvedError;
        } finally {
            this.stopAutoSaveLoop();
            if (this.chunkManager) await this.chunkManager.cleanup(downloadSucceeded);
        }
    }

    private async downloadSingleFile(url: string): Promise<void> {
        const segment = this.chunkManager!.getNextPendingSegment();

        if (!segment) throw new Error("No segment available");

        this.chunkManager!.markSegmentDownloading(segment.index);
        const initialDownloadedBytes = segment.downloadedBytes;
        let offset = initialDownloadedBytes;

        await this.httpClient.downloadFile(
            url,
            this.abortController.signal,
            async (chunk: Buffer) => {
                await this.chunkManager!.writeSegmentChunk(segment.index, offset, chunk);
                offset += chunk.length;
            },
            (bytes: number) => {
                this.chunkManager!.updateSegmentProgress(
                    segment.index,
                    initialDownloadedBytes + bytes
                );
                this.updateProgress();
            }
        );

        await this.chunkManager!.markSegmentCompleted(segment.index);
        this.updateProgress(true);

        this.info.status = "completed";
        this.info.endTime = new Date();
        this.emit(DownloadTaskEventName.Complete, this.info);
    }

    private async downloadWithSegments(urls: string[]): Promise<void> {
        let urlIndex = 0;

        while (!this.chunkManager!.isComplete() && !this.isCancelled) {
            if (this.isPaused) await this.waitForResume();

            if (this.isCancelled) break;

            const segment = this.chunkManager!.getNextPendingSegment();

            if (!segment) {
                await this.queue.onIdle();
                continue;
            }

            this.chunkManager!.markSegmentDownloading(segment.index);

            // Don't await - allow parallel downloads!
            this.queue.add(() => this.downloadSegment(urls[urlIndex % urls.length], segment));
            urlIndex++;
        }

        await this.queue.onIdle();
        this.updateProgress(true);

        if (!this.isCancelled) {
            this.info.status = "completed";
            this.info.endTime = new Date();
            this.emit(DownloadTaskEventName.Complete, this.info);
        }
    }

    private async downloadSegment(url: string, segment: Segment): Promise<void> {
        const initialDownloadedBytes = segment.downloadedBytes;
        let offset = initialDownloadedBytes;

        return this.httpClient
            .downloadSegment(
                url,
                segment,
                this.abortController.signal,
                async (chunk: Buffer) => {
                    await this.chunkManager!.writeSegmentChunk(segment.index, offset, chunk);
                    offset += chunk.length;
                },
                (bytes: number) => {
                    this.chunkManager!.updateSegmentProgress(
                        segment.index,
                        initialDownloadedBytes + bytes
                    );
                    this.updateProgress();
                }
            )
            .then(async () => {
                await this.chunkManager!.markSegmentCompleted(segment.index);
                this.updateProgress(true);
                this.emit(DownloadTaskEventName.SegmentComplete, this.info, segment);
            })
            .catch((error: unknown) => {
                // Suppress errors if task is cancelled
                if (this.isCancelled) return;

                const resolvedError = toError(error, "Segment download failed");
                if (this.chunkManager) this.chunkManager.markSegmentFailed(segment.index);
                this.emit(DownloadTaskEventName.SegmentError, this.info, segment, resolvedError);
            });
    }

    private updateProgress(forceEmit = false): void {
        const progress = this.chunkManager!.getProgress();

        const elapsedMs = Date.now() - this.startTime;
        if (elapsedMs > 0) {
            progress.speed = calculateSpeed(progress.downloadedBytes, elapsedMs, this.speedSamples);

            if (progress.speed > 0) {
                const remainingBytes = progress.totalBytes - progress.downloadedBytes;
                progress.eta = Math.floor(remainingBytes / progress.speed);
            }
        }

        this.info.progress = progress;
        this.info.segments = this.chunkManager!.getSegments();

        const now = Date.now();
        const shouldEmit =
            forceEmit ||
            Math.abs(progress.percent - this.lastProgressValue) >=
                PROGRESS_UPDATE_MIN_PERCENT_DELTA ||
            now - this.lastProgressEmit >= PROGRESS_UPDATE_MIN_INTERVAL_MS;

        if (shouldEmit) {
            this.emit(DownloadTaskEventName.Progress, this.info, progress);
            this.lastProgressEmit = now;
            this.lastProgressValue = progress.percent;
        }
    }

    pause(): void {
        this.isPaused = true;
        this.info.status = "paused";
        this.emit(DownloadTaskEventName.Pause, this.info);
    }

    resume(): void {
        this.isPaused = false;
        this.info.status = "downloading";
        this.emit(DownloadTaskEventName.Resume, this.info);
    }

    cancel(): void {
        this.isCancelled = true;
        this.abortController.abort();
        this.info.status = "cancelled";
        this.emit(DownloadTaskEventName.Cancel, this.info);
    }

    private waitForResume(): Promise<void> {
        return new Promise<void>(resolve => {
            const checkInterval = setInterval(() => {
                if (!this.isPaused || this.isCancelled) {
                    clearInterval(checkInterval);
                    resolve();
                }
            }, 100);
        });
    }

    private startAutoSaveLoop(): void {
        if (
            !this.options.resumeDownloads ||
            this.options.autoSaveInterval <= 0 ||
            !this.chunkManager
        )
            return;

        this.stopAutoSaveLoop();
        const intervalMs = this.options.autoSaveInterval * 1000;
        this.autoSaveTimer = setInterval(() => {
            if (!this.chunkManager || this.autoSaveInFlight) return;

            this.autoSaveInFlight = true;
            void this.chunkManager.saveProgress().finally(() => {
                this.autoSaveInFlight = false;
            });
        }, intervalMs);
    }

    private stopAutoSaveLoop(): void {
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
            this.autoSaveTimer = null;
        }
    }
}
