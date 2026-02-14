export interface Segment {
    index: number;
    startByte: number;
    endByte: number;
    downloadedBytes: number;
    status: "pending" | "downloading" | "completed" | "failed";
}

export interface DownloadProgress {
    totalBytes: number;
    downloadedBytes: number;
    percent: number;
    speed: number; // bytes per second
    eta: number; // seconds
}

export interface DownloaderOptions {
    // Parallelism
    split?: number;
    maxConcurrentDownloads?: number;
    maxConnectionsPerServer?: number;

    // Chunking/Segments
    segmentSize?: number | string; // e.g., 1048576 or "1MB"

    // Network
    timeout?: number;
    retries?: number;
    retryDelay?: number;
    headers?: Record<string, string>;

    // Bandwidth
    maxDownloadSpeed?: number; // bytes per second

    // Storage
    outputDirectory?: string;
    fileAllocation?: "none" | "trunc" | "prealloc" | "falloc";

    // Resume
    resumeDownloads?: boolean;
    autoSaveInterval?: number; // seconds
    alwaysResume?: boolean;
    controlFileDirectory?: string;
}

export interface DownloadOptions {
    urls: string | string[]; // Single URL or multiple for multi-source
    filename?: string;
    outputDir?: string;
    headers?: Record<string, string>;
    initialDownloadedBytes?: number;
    initialSegments?: Segment[];
}

export interface DownloadTaskInfo {
    id: string;
    urls: string[];
    filename: string;
    outputPath: string;
    totalSize: number;
    segments: Segment[];
    status: "pending" | "downloading" | "paused" | "completed" | "failed" | "cancelled";
    progress: DownloadProgress;
    error?: Error;
    startTime?: Date;
    endTime?: Date;
}

export interface ControlFileData {
    version: string;
    urls: string[];
    filename: string;
    outputPath: string;
    totalSize: number;
    downloadedBytes?: number;
    segments: Segment[];
    createdAt: string;
    lastModified: string;
}

export type DownloadStatus =
    | "pending"
    | "downloading"
    | "paused"
    | "completed"
    | "failed"
    | "cancelled";

export enum DownloadTaskEventName {
    Start = "start",
    Progress = "progress",
    SegmentComplete = "segmentComplete",
    SegmentError = "segmentError",
    Complete = "complete",
    Error = "error",
    Redirect = "redirect",
    Pause = "pause",
    Resume = "resume",
    Cancel = "cancel",
}

export enum DownloaderEventName {
    Start = "start",
    Progress = "progress",
    Segment = "segment",
    SegmentError = "segmentError",
    Complete = "complete",
    Error = "error",
    Redirect = "redirect",
    Pause = "pause",
    Resume = "resume",
    Cancel = "cancel",
}

export interface DownloadTaskEventMap {
    start: (info: DownloadTaskInfo) => void;
    progress: (info: DownloadTaskInfo, progress: DownloadProgress) => void;
    segmentComplete: (info: DownloadTaskInfo, segment: Segment) => void;
    segmentError: (info: DownloadTaskInfo, segment: Segment, error: Error) => void;
    complete: (info: DownloadTaskInfo) => void;
    error: (info: DownloadTaskInfo, error: Error) => void;
    redirect: (info: DownloadTaskInfo, fromUrl: string, toUrl: string) => void;
    pause: (info: DownloadTaskInfo) => void;
    resume: (info: DownloadTaskInfo) => void;
    cancel: (info: DownloadTaskInfo) => void;
}

export interface DownloaderEventMap {
    start: (info: DownloadTaskInfo) => void;
    progress: (info: DownloadTaskInfo, progress: DownloadProgress) => void;
    segment: (info: DownloadTaskInfo, segment: Segment) => void;
    segmentError: (info: DownloadTaskInfo, segment: Segment, error: Error) => void;
    complete: (info: DownloadTaskInfo) => void;
    error: (info: DownloadTaskInfo, error: Error) => void;
    redirect: (info: DownloadTaskInfo, fromUrl: string, toUrl: string) => void;
    pause: (info: DownloadTaskInfo) => void;
    resume: (info: DownloadTaskInfo) => void;
    cancel: (info: DownloadTaskInfo) => void;
}
