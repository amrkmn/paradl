import { mergeOptions } from "@/config";
import { DownloadTask } from "@/core";
import { DownloaderEventName, DownloadTaskEventName } from "@/types";
import type {
    DownloaderEventMap,
    DownloaderOptions,
    DownloadOptions,
    DownloadTaskInfo,
} from "@/types";
import { randomUUID } from "crypto";
import { TypedEventEmitter } from "@/utils/TypedEventEmitter";
import PQueue from "p-queue";

export class Downloader extends TypedEventEmitter<DownloaderEventMap> {
    private options: Required<DownloaderOptions>;
    private downloadQueue: PQueue;
    private activeTasks: Map<string, DownloadTask> = new Map();

    constructor(options?: DownloaderOptions) {
        super();
        this.options = mergeOptions(options);

        this.downloadQueue = new PQueue({
            concurrency: this.options.maxConcurrentDownloads,
        });
    }

    async download(options: DownloadOptions): Promise<DownloadTask> {
        const id = randomUUID();
        const task = new DownloadTask(this.options, id);

        // Setup event forwarding
        this.setupTaskEvents(task);

        this.activeTasks.set(id, task);

        // Add to queue
        const downloadPromise = this.downloadQueue.add(async () =>
            task
                .start(options)
                .catch(() => {
                    // Error is already handled in task events
                })
                .finally(() => this.activeTasks.delete(id))
        );

        // Store completion promise on the task for later access
        task.completionPromise = downloadPromise;

        return task;
    }

    async downloadAndWait(options: DownloadOptions): Promise<DownloadTaskInfo> {
        const task = await this.download(options);
        await task.completionPromise;
        return task.info;
    }

    pause(taskId: string): boolean {
        const task = this.activeTasks.get(taskId);
        if (task && task.info.status === "downloading") {
            task.pause();
            return true;
        }
        return false;
    }

    resume(taskId: string): boolean {
        const task = this.activeTasks.get(taskId);
        if (task && task.info.status === "paused") {
            task.resume();
            return true;
        }
        return false;
    }

    cancel(taskId: string): boolean {
        const task = this.activeTasks.get(taskId);
        if (task) {
            task.cancel();
            this.activeTasks.delete(taskId);
            return true;
        }
        return false;
    }

    pauseAll(): void {
        for (const task of this.activeTasks.values())
            if (task.info.status === "downloading") task.pause();
    }

    resumeAll(): void {
        for (const task of this.activeTasks.values())
            if (task.info.status === "paused") task.resume();
    }

    cancelAll(): void {
        for (const task of this.activeTasks.values()) {
            task.cancel();
        }
        this.activeTasks.clear();
    }

    getActiveTasks(): DownloadTaskInfo[] {
        return Array.from(this.activeTasks.values()).map(task => task.info);
    }

    getTask(taskId: string): DownloadTaskInfo | undefined {
        return this.activeTasks.get(taskId)?.info;
    }

    async waitForAll(): Promise<void> {
        await this.downloadQueue.onIdle();
    }

    private setupTaskEvents(task: DownloadTask): void {
        const eventMapping: Array<{
            from: DownloadTaskEventName;
            to: DownloaderEventName;
        }> = [
            { from: DownloadTaskEventName.Start, to: DownloaderEventName.Start },
            { from: DownloadTaskEventName.Progress, to: DownloaderEventName.Progress },
            { from: DownloadTaskEventName.SegmentComplete, to: DownloaderEventName.Segment },
            { from: DownloadTaskEventName.SegmentError, to: DownloaderEventName.SegmentError },
            { from: DownloadTaskEventName.Complete, to: DownloaderEventName.Complete },
            { from: DownloadTaskEventName.Error, to: DownloaderEventName.Error },
            { from: DownloadTaskEventName.Redirect, to: DownloaderEventName.Redirect },
            { from: DownloadTaskEventName.Pause, to: DownloaderEventName.Pause },
            { from: DownloadTaskEventName.Resume, to: DownloaderEventName.Resume },
            { from: DownloadTaskEventName.Cancel, to: DownloaderEventName.Cancel },
        ];

        for (const { from, to } of eventMapping) {
            task.on(from, (...args: unknown[]) => {
                this.emit(to, ...args);
            });
        }
    }

    // Static convenience methods
    static async quickDownload(
        urls: string | string[],
        options?: DownloaderOptions & { outputDir?: string; filename?: string }
    ): Promise<DownloadTaskInfo> {
        const downloader = new Downloader(options);

        return new Promise((resolve, reject) => {
            downloader.on(DownloaderEventName.Complete, info => {
                resolve(info);
            });

            downloader.on(DownloaderEventName.Error, (_info, error) => {
                reject(error);
            });

            downloader.downloadAndWait({
                urls,
                outputDir: options?.outputDir,
                filename: options?.filename,
            });
        });
    }
}
