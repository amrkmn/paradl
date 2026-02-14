import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ControlFile } from "@/storage";
import type { SegmentWriter } from "@/storage";
import type { ControlFileData, Segment, DownloadProgress } from "@/types";

interface ChunkManagerOptions {
    segmentSize: number;
    maxSplits: number;
    totalSize: number;
    outputPath: string;
    fileAllocation: "none" | "trunc" | "prealloc" | "falloc";
    resumeDownloads: boolean;
    alwaysResume: boolean;
    controlFile: ControlFile;
    urls: string[];
}

export class ChunkManager {
    public segments: Segment[] = [];
    public downloadedBytes = 0;
    private segmentSize: number;
    private maxSplits: number;
    private totalSize: number;
    private outputPath: string;
    private fileAllocation: "none" | "trunc" | "prealloc" | "falloc";
    private resumeDownloads: boolean;
    private alwaysResume: boolean;
    private controlFile: ControlFile;
    private urls: string[] = [];
    private startTime = 0;
    private writer: SegmentWriter | null = null;

    constructor(options: ChunkManagerOptions) {
        this.segmentSize = options.segmentSize;
        this.maxSplits = Math.max(1, options.maxSplits);
        this.totalSize = options.totalSize;
        this.outputPath = options.outputPath;
        this.fileAllocation = options.fileAllocation;
        this.resumeDownloads = options.resumeDownloads;
        this.alwaysResume = options.alwaysResume;
        this.controlFile = options.controlFile;
        this.urls = options.urls;
    }

    async initialize(): Promise<void> {
        // Ensure output directory exists
        const outputDir = dirname(this.outputPath);
        await mkdir(outputDir, { recursive: true });

        const { SegmentWriter } = await import("@/storage");
        const existingFile = await SegmentWriter.exists(this.outputPath);
        const controlFileExists = this.resumeDownloads ? await this.controlFile.exists() : false;

        // Early validation: resume required but control file missing
        if (
            this.resumeDownloads &&
            this.alwaysResume &&
            existingFile.exists &&
            existingFile.size > 0 &&
            !controlFileExists
        ) {
            throw new Error(`Resume required but control file is missing for ${this.outputPath}.`);
        }

        // Initialize file writer
        await this.initWriter();

        // Load resume data if available
        const resumeData: ControlFileData | null = this.resumeDownloads
            ? await this.controlFile.load().catch(() => null)
            : null;

        // Handle resume data or create fresh segments
        if (resumeData) {
            await this.loadResumeData(resumeData);
        } else {
            this.createSegments();
        }

        this.startTime = Date.now();

        if (this.resumeDownloads) await this.saveProgress();
    }

    /**
     * Load and validate resume data from control file
     */
    private async loadResumeData(resumeData: ControlFileData): Promise<void> {
        const hasValidSegments =
            resumeData.segments &&
            Array.isArray(resumeData.segments) &&
            resumeData.segments.length > 0;

        // Invalid resume data handling
        if (!hasValidSegments) {
            if (this.alwaysResume) {
                throw new Error(
                    `Resume required but control data is invalid for ${this.outputPath}.`
                );
            }
            this.createSegments();
            return;
        }

        // Load and normalize segments
        this.segments = resumeData.segments.map((segment: Segment) => {
            const fullSize = segment.endByte - segment.startByte + 1;
            const normalizedBytes = Math.max(0, Math.min(segment.downloadedBytes, fullSize));
            const completed = normalizedBytes >= fullSize;

            return {
                ...segment,
                downloadedBytes: normalizedBytes,
                status: completed ? "completed" : "pending",
            };
        });

        // Calculate resumed bytes
        const resumedBytes = this.segments.reduce(
            (sum: number, segment: Segment) => sum + segment.downloadedBytes,
            0
        );
        this.downloadedBytes =
            typeof resumeData.downloadedBytes === "number"
                ? Math.max(0, Math.min(resumeData.downloadedBytes, this.totalSize))
                : resumedBytes;

        // Validate segment sizes match current file size
        await this.validateSegmentSizes(resumeData);
    }

    /**
     * Validate that saved segment sizes match current file size
     */
    private async validateSegmentSizes(resumeData: ControlFileData): Promise<void> {
        const expectedTotalSize = resumeData.segments.reduce(
            (sum: number, seg: Segment) => sum + (seg.endByte - seg.startByte + 1),
            0
        );

        if (expectedTotalSize === this.totalSize) {
            return; // Sizes match, nothing to do
        }

        // Size mismatch handling
        if (this.alwaysResume) {
            throw new Error(
                `Resume required but saved segment size does not match current file size for ${this.outputPath}.`
            );
        }

        // File size changed, recreate segments
        this.createSegments();
        this.downloadedBytes = 0;
    }

    private createSegments(): void {
        this.segments = [];
        this.downloadedBytes = 0;

        const maxSegmentsBySize = Math.max(1, Math.floor(this.totalSize / this.segmentSize));
        const targetSegments = Math.max(1, Math.min(this.maxSplits, maxSegmentsBySize));
        const segmentSize = Math.ceil(this.totalSize / targetSegments);

        let startByte = 0;
        let index = 0;

        while (startByte < this.totalSize) {
            const endByte = Math.min(startByte + segmentSize - 1, this.totalSize - 1);

            this.segments.push({
                index,
                startByte,
                endByte,
                downloadedBytes: 0,
                status: "pending",
            });

            startByte = endByte + 1;
            index++;
        }
    }

    /**
     * Write a chunk to a segment at specific offset (streaming)
     */
    async writeSegmentChunk(index: number, offset: number, chunk: Buffer): Promise<void> {
        const segment = this.segments[index];
        if (!segment) throw new Error(`Segment ${index} not found`);

        if (!this.writer) throw new Error("Writer not initialized");

        const position = segment.startByte + offset;
        await this.writer.writeSegment(position, chunk);
    }

    /**
     * Write segment data to file (complete segment)
     */
    async writeSegment(index: number, data: Buffer): Promise<void> {
        const segment = this.segments[index];
        if (!segment) throw new Error(`Segment ${index} not found`);

        if (!this.writer) throw new Error("Writer not initialized");

        const position = segment.startByte;
        await this.writer.writeSegment(position, data);
    }

    /**
     * Mark segment as downloading
     */
    markSegmentDownloading(index: number): void {
        const segment = this.segments[index];
        if (segment) segment.status = "downloading";
    }

    /**
     * FIX: Set segment progress (not add!) - bytes parameter is cumulative from download
     */
    updateSegmentProgress(index: number, bytes: number): void {
        const segment = this.segments[index];
        if (segment) {
            // FIX: Set the value, don't add it!
            const delta = bytes - segment.downloadedBytes;
            segment.downloadedBytes = bytes;
            this.downloadedBytes += delta;
        }
    }

    /**
     * Mark segment as completed
     */
    async markSegmentCompleted(index: number): Promise<void> {
        const segment = this.segments[index];
        if (segment) {
            segment.status = "completed";
            const fullSize = segment.endByte - segment.startByte + 1;
            const delta = fullSize - segment.downloadedBytes;
            segment.downloadedBytes = fullSize;
            if (delta !== 0) {
                this.downloadedBytes += delta;
            }
        }

        await this.saveProgress();
    }

    /**
     * Mark segment as failed
     */
    markSegmentFailed(index: number): void {
        const segment = this.segments[index];
        if (segment) segment.status = "failed";
    }

    /**
     * Get next pending segment
     */
    getNextPendingSegment(): Segment | null {
        return this.segments.find(s => s.status === "pending") || null;
    }

    /**
     * Check if all segments are completed
     */
    isComplete(): boolean {
        return this.segments.every(s => s.status === "completed");
    }

    /**
     * Get current progress
     */
    getProgress(): DownloadProgress {
        const clampedDownloaded = Math.min(this.downloadedBytes, this.totalSize);
        const elapsedSeconds = (Date.now() - this.startTime) / 1000;
        const speed = elapsedSeconds > 0 ? clampedDownloaded / elapsedSeconds : 0;
        const remainingBytes = Math.max(0, this.totalSize - clampedDownloaded);
        const eta = speed > 0 ? remainingBytes / speed : 0;
        const percent = this.totalSize > 0 ? (clampedDownloaded / this.totalSize) * 100 : 0;

        return {
            totalBytes: this.totalSize,
            downloadedBytes: clampedDownloaded,
            percent: Math.min(percent, 100),
            speed,
            eta,
        };
    }

    /**
     * Initialize writer
     */
    async initWriter(): Promise<void> {
        const { SegmentWriter } = await import("@/storage");
        this.writer = new SegmentWriter();
        await this.writer.open(this.outputPath, this.totalSize, this.fileAllocation);
    }

    /**
     * Save progress to control file
     */
    async saveProgress(): Promise<void> {
        if (this.resumeDownloads) {
            await this.controlFile.save({
                version: "1.0",
                urls: this.urls,
                filename: this.outputPath.split("/").pop() || "",
                outputPath: this.outputPath,
                totalSize: this.totalSize,
                segments: this.segments,
                createdAt: new Date().toISOString(),
                lastModified: new Date().toISOString(),
            });
        }
    }

    /**
     * Close writer and cleanup
     */
    async cleanup(success = false): Promise<void> {
        if (this.writer) await this.writer.close();

        if (success && this.resumeDownloads) await this.controlFile.delete();
    }

    /**
     * Get segments for multi-source downloading
     */
    getSegments(): Segment[] {
        return [...this.segments];
    }
}
