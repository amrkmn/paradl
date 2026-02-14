import type { ControlFileData, Segment } from "@/types";
import { access, mkdir, readFile, unlink, writeFile } from "fs/promises";
import { dirname } from "path";
import { CONTROL_FILE_EXTENSION } from "@/utils/constants";
import { ignoreFileNotFound } from "@/utils/common";

export class ControlFile {
    private controlFilePath: string;

    constructor(filePath: string) {
        this.controlFilePath = `${filePath}${CONTROL_FILE_EXTENSION}`;
    }

    /**
     * Save control file for resume support
     */
    async save(data: ControlFileData): Promise<void> {
        // Ensure directory exists
        const dir = dirname(this.controlFilePath);
        await mkdir(dir, { recursive: true });

        await writeFile(this.controlFilePath, JSON.stringify(data, null, 2), "utf-8");
    }

    /**
     * Load control file
     */
    async load(): Promise<ControlFileData | null> {
        return readFile(this.controlFilePath, "utf-8")
            .then(content => JSON.parse(content) as ControlFileData)
            .catch(() => null);
    }

    /**
     * Check if control file exists
     */
    async exists(): Promise<boolean> {
        return access(this.controlFilePath)
            .then(() => true)
            .catch(() => false);
    }

    /**
     * Delete control file
     */
    async delete(): Promise<void> {
        await unlink(this.controlFilePath).catch(error => {
            if (!ignoreFileNotFound(error)) throw error;
        });
    }

    /**
     * Get control file path
     */
    getPath(): string {
        return this.controlFilePath;
    }
}

export type { ControlFileData, Segment };
