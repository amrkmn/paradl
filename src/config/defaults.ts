import type { DownloaderOptions } from "@/types";
import { DEFAULT_SEGMENT_SIZE_BYTES, DEFAULT_TIMEOUT_MS, DEFAULT_RETRIES } from "@/utils/constants";

export const DEFAULT_OPTIONS: Required<DownloaderOptions> = {
    split: 5,
    maxConcurrentDownloads: 5,
    maxConnectionsPerServer: 1,
    segmentSize: DEFAULT_SEGMENT_SIZE_BYTES,
    timeout: DEFAULT_TIMEOUT_MS,
    retries: DEFAULT_RETRIES,
    retryDelay: 1000,
    headers: {},
    maxDownloadSpeed: 0, // 0 = unlimited
    outputDirectory: "./downloads",
    fileAllocation: "trunc",
    resumeDownloads: true,
    autoSaveInterval: 60,
    alwaysResume: true,
    controlFileDirectory: "./downloads",
};

export function parseSegmentSize(size: number | string): number {
    if (typeof size === "number") return size;

    const units: Record<string, number> = {
        B: 1,
        KB: 1024,
        MB: 1024 * 1024,
        GB: 1024 * 1024 * 1024,
    };

    const match = size.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)$/i);
    if (!match) throw new Error(`Invalid segment size format: ${size}`);

    const value = parseFloat(match[1]!);
    const unit = match[2]?.toUpperCase();

    if (!unit || !units[unit]) throw new Error(`Invalid unit in segment size: ${size}`);

    return Math.floor(value * units[unit]);
}

export function mergeOptions(options?: DownloaderOptions): Required<DownloaderOptions> {
    return {
        ...DEFAULT_OPTIONS,
        ...options,
        headers: {
            ...DEFAULT_OPTIONS.headers,
            ...options?.headers,
        },
    };
}
