/**
 * Common utility functions shared across the codebase
 */

/**
 * Extract filename from URL
 */
export function extractFilename(url: string): string {
    try {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname;
        const filename = pathname.split("/").pop() || "download";
        return decodeURIComponent(filename);
    } catch {
        return "download";
    }
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
    if (bytes === 0) return "0B";
    const k = 1024;
    const sizes = ["B", "KiB", "MiB", "GiB", "TiB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + sizes[i];
}

/**
 * Format duration in seconds to human-readable string
 */
export function formatDuration(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return "--";
    if (seconds < 0.5) return "<1s";

    if (seconds < 60) return `${Math.floor(seconds)}s`;

    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);

    if (minutes < 60) return secs > 0 ? `${minutes}m${secs}s` : `${minutes}m`;

    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h${mins}m` : `${hours}h`;
}

/**
 * Helper to ignore ENOENT errors in file operations
 */
export function ignoreFileNotFound(error: unknown): error is NodeJS.ErrnoException {
    return (error as { code: string }).code === "ENOENT";
}

/**
 * Convert unknown error to Error instance
 */
export function toError(error: unknown, defaultMessage: string): Error {
    return error instanceof Error ? error : new Error(`${defaultMessage}: ${String(error)}`);
}

export const SPEED_SAMPLE_COUNT = 10;

export function calculateSpeed(
    downloadedBytes: number,
    elapsedMs: number,
    samples: number[],
    sampleCount: number = SPEED_SAMPLE_COUNT
): number {
    if (elapsedMs <= 0) return 0;

    const instantSpeed = (downloadedBytes / elapsedMs) * 1000;
    samples.push(instantSpeed);

    if (samples.length > sampleCount) samples.shift();

    const avgSpeed = samples.reduce((a, b) => a + b, 0) / samples.length;
    return Math.floor(avgSpeed);
}
