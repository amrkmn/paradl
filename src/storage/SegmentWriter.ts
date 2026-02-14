import { mkdir, open, stat, unlink, type FileHandle } from "fs/promises";
import { dirname } from "path";
import { PREALLOC_BUFFER_SIZE } from "@/utils/constants";
import { ignoreFileNotFound } from "@/utils/common";

export class SegmentWriter {
    private fileHandle: FileHandle | null = null;

    /**
     * Open file for writing with optional pre-allocation
     */
    async open(
        filePath: string,
        size: number,
        allocation: "none" | "trunc" | "prealloc" | "falloc" = "trunc"
    ): Promise<void> {
        // Ensure directory exists
        const dir = dirname(filePath);
        await mkdir(dir, { recursive: true });

        // Open existing file in-place for resume safety; create when missing.
        const existing = await SegmentWriter.exists(filePath);
        this.fileHandle = await open(filePath, existing.exists ? "r+" : "w");

        // Pre-allocate file space
        switch (allocation) {
            case "trunc":
                await this.fileHandle.truncate(size);
                break;
            case "prealloc":
                await this.fileHandle.truncate(size).catch(() => this.fileHandle!.truncate(size));
                const buffer = Buffer.alloc(PREALLOC_BUFFER_SIZE, 0);
                let written = 0;
                while (written < size) {
                    const toWrite = Math.min(buffer.length, size - written);
                    await this.fileHandle.write(buffer, 0, toWrite, written);
                    written += toWrite;
                }
                break;
            case "falloc":
                await this.fileHandle.truncate(size).catch(() => this.fileHandle!.truncate(size));
                // Note: Native fallocate would require native bindings
                // This falls back to truncate
                break;
            case "none":
            default:
                // Don't pre-allocate
                break;
        }
    }

    /**
     * Write segment data to specific position
     */
    async writeSegment(position: number, data: Buffer): Promise<void> {
        if (!this.fileHandle) throw new Error("File not open");
        await this.fileHandle.write(data, 0, data.length, position);
    }

    /**
     * Close file
     */
    async close(): Promise<void> {
        if (this.fileHandle) {
            await this.fileHandle.close();
            this.fileHandle = null;
        }
    }

    /**
     * Check if file exists and get size
     */
    static async exists(filePath: string): Promise<{ exists: boolean; size: number }> {
        return stat(filePath)
            .then(stats => ({ exists: true, size: stats.size }))
            .catch(() => ({ exists: false, size: 0 }));
    }

    /**
     * Delete file
     */
    static async delete(filePath: string): Promise<void> {
        await unlink(filePath).catch<unknown>(error => {
            // Only ignore ENOENT (file not found), re-throw others
            if (ignoreFileNotFound(error)) return;
            throw error;
        });
    }
}
