#!/usr/bin/env node

import { existsSync } from "fs";
import { unlink, readdir } from "fs/promises";
import { join, resolve, basename, parse } from "path";
import { Downloader, type DownloadTask } from "@/core";
import { ControlFile } from "@/storage";
import type { DownloadProgress, DownloadTaskInfo, Segment } from "@/types";
import { DownloaderEventName } from "@/types";
import { log, parseLogLevel } from "@/utils/logger";
import { extractFilename, formatBytes, formatDuration } from "@/utils/common";
import { GID_LENGTH, GID_PREFIX } from "@/utils/constants";
import { Command } from "commander";

interface ActiveTask {
    task: DownloadTask;
    info: DownloadTaskInfo;
    gid: string;
    startTime: number;
    outputPath: string;
    controlFile: ControlFile;
}

interface CliOptions {
    maxConcurrentDownloads: string;
    output: string;
    filename?: string;
    split: string;
    maxConnectionPerServer: string;
    segmentSize: string;
    resume: boolean;
    autoSaveInterval: string;
    alwaysResume: boolean;
    allocation: "none" | "trunc" | "prealloc" | "falloc";
    logLevel: string;
    verbose?: boolean;
}

function parseNumberOption(value: string, optionName: string): number {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid value for ${optionName}: ${value}`);
    }
    return parsed;
}

async function findAvailableFilename(filePath: string): Promise<string> {
    const dir = resolve(filePath, "..");
    const parsed = parse(filePath);
    const name = parsed.name;
    const ext = parsed.ext;

    if (!existsSync(filePath)) {
        return basename(filePath);
    }

    let counter = 1;
    while (true) {
        const newFilename = `${name}.${counter}${ext}`;
        const newPath = join(dir, newFilename);
        if (!existsSync(newPath)) {
            return newFilename;
        }
        counter++;
    }
}

/**
 * Find existing incomplete downloads (control files) for the given base filename.
 * Returns the most recent incomplete download's info, or null if none found.
 */
async function findIncompleteDownload(
    outputDir: string,
    baseFilename: string
): Promise<{ filename: string; controlFile: ControlFile } | null> {
    const parsed = parse(baseFilename);
    const name = parsed.name;
    const ext = parsed.ext;

    try {
        const files = await readdir(outputDir);
        const controlFiles: Array<{ filename: string; mtime: number }> = [];

        // Look for control files matching: name.paradl, name.1.ext.paradl, name.2.ext.paradl, etc.
        for (const file of files) {
            if (!file.endsWith(".paradl")) continue;

            const targetFilename = file.slice(0, -7); // Remove .paradl
            const targetParsed = parse(targetFilename);

            // Check if it matches the base name (exact or numbered variant)
            const isExactMatch = targetFilename === baseFilename;
            const isNumberedVariant =
                targetParsed.name.match(new RegExp(`^${name}\\.\\d+$`)) && targetParsed.ext === ext;

            if (isExactMatch || isNumberedVariant) {
                const controlFilePath = join(outputDir, file);
                const stats = await import("fs/promises").then(fs =>
                    fs.stat(controlFilePath).catch(() => null)
                );
                if (stats) {
                    controlFiles.push({
                        filename: targetFilename,
                        mtime: stats.mtimeMs,
                    });
                }
            }
        }

        if (controlFiles.length === 0) {
            return null;
        }

        // Return the most recently modified control file
        controlFiles.sort((a, b) => b.mtime - a.mtime);
        const mostRecent = controlFiles[0];
        const controlFile = new ControlFile(join(outputDir, mostRecent.filename));

        return {
            filename: mostRecent.filename,
            controlFile,
        };
    } catch {
        return null;
    }
}

const program = new Command();

program
    .name("paradl")
    .description("@amrkmn/paradl - High-performance multipart downloader")
    .version("1.0.0")
    .argument("<urls...>", "URL(s) to download")
    .option("-o, --output <dir>", "Output directory", "./downloads")
    .option("-f, --filename <name>", "Output filename")
    .option(
        "-j, --max-concurrent-downloads <number>",
        "Set maximum number of parallel downloads",
        "5"
    )
    .option("-s, --split <number>", "Download a file using N splits", "5")
    .option(
        "-x, --max-connection-per-server <number>",
        "The maximum number of connections to one server for each download",
        "1"
    )
    .option(
        "-k, --segment-size <size>",
        "Minimum segment size for splitting (e.g., 20MB, 512KB)",
        "20MB"
    )
    .option("--no-resume", "Disable resume support")
    .option("--auto-save-interval <seconds>", "Auto-save interval for control file", "60")
    .option("--no-always-resume", "Allow restarting from scratch when resume state is unavailable")
    .option(
        "-a, --allocation <method>",
        "File allocation method (none|trunc|prealloc|falloc)",
        "trunc"
    )
    .option("--log-level <level>", "Set log level (debug, info, warn, error, silent)", "info")
    .option("-v, --verbose", "Alias for --log-level debug")
    .action(async (urls: string[], options: CliOptions) => {
        // Initialize logger level
        let logLevelStr = options.logLevel;
        if (options.verbose) logLevelStr = "debug";
        log.setLevel(parseLogLevel(logLevelStr));

        log.debug(`URLs: ${urls.join(", ")}`);
        log.debug(`Options: ${JSON.stringify(options)}`);

        const downloader = new Downloader({
            split: parseNumberOption(options.split, "--split"),
            maxConcurrentDownloads: parseNumberOption(
                options.maxConcurrentDownloads,
                "--max-concurrent-downloads"
            ),
            maxConnectionsPerServer: parseNumberOption(
                options.maxConnectionPerServer,
                "--max-connection-per-server"
            ),
            segmentSize: options.segmentSize,
            timeout: 30000,
            retries: 3,
            fileAllocation: options.allocation,
            resumeDownloads: options.resume,
            autoSaveInterval: parseNumberOption(options.autoSaveInterval, "--auto-save-interval"),
            alwaysResume: options.alwaysResume,
        });

        let activeTasks: ActiveTask[] = [];
        const seenRedirects = new Map<string, Set<string>>();
        let shuttingDown = false;

        const startHandler = (_info: DownloadTaskInfo) => {
            log.info("Downloading 1 item(s)");
        };

        const progressHandler = (info: DownloadTaskInfo, progress: DownloadProgress) => {
            // Don't show progress during shutdown
            if (shuttingDown) return;

            const taskInfo = activeTasks.find(t => t.info.id === info.id);
            if (!taskInfo) return;

            const gid = taskInfo.gid || "??????";
            const percent = progress.percent.toFixed(1);
            const cn = info.segments.filter(segment => segment.status === "downloading").length;
            const dl = progress.speed > 0 ? formatBytes(progress.speed) + "/s" : "--";
            const eta = formatDuration(progress.eta);

            log.progress({
                gid,
                progressText: `${formatBytes(progress.downloadedBytes)}/${formatBytes(progress.totalBytes)}(${percent}%)`,
                connections: cn,
                speedText: dl,
                etaText: eta,
            });
        };

        const completeHandler = async (info: DownloadTaskInfo) => {
            const taskInfo = activeTasks.find(t => t.info.id === info.id);
            if (!taskInfo) return;

            log.stopProgress();

            const elapsed = taskInfo.startTime ? (Date.now() - taskInfo.startTime) / 1000 : 0;
            const avgSpeed = elapsed > 0 ? formatBytes(info.totalSize / elapsed) + "/s" : "--";

            log.success(
                `Download complete: ${formatBytes(info.totalSize)} in ${formatDuration(elapsed)} (${avgSpeed})`
            );
            log.info(`Saved to: ${taskInfo.outputPath}`);

            // Delete control file when download completes successfully
            if (taskInfo.controlFile) {
                const controlFilePath = `${taskInfo.outputPath}.paradl`;
                unlink(controlFilePath).catch(() => {
                    // Ignore errors if file doesn't exist
                });
            }

            activeTasks = activeTasks.filter(t => t.info.id !== info.id);
            seenRedirects.delete(info.id);
        };

        const errorHandler = (info: DownloadTaskInfo, error: Error) => {
            log.stopProgress();
            log.error(String(error.message || error));
            activeTasks = activeTasks.filter(t => t.info.id !== info.id);
            seenRedirects.delete(info.id);
        };

        const segmentErrorHandler = (_info: DownloadTaskInfo, segment: Segment, error: Error) => {
            // Don't log segment errors during shutdown (expected due to abort)
            if (!shuttingDown) {
                // Segment errors are warnings as they will be retried
                log.warn(`Segment ${segment.index} failed: ${error.message}`);
            }
        };

        const redirectHandler = (info: DownloadTaskInfo, _fromUrl: string, toUrl: string) => {
            const redirectSet = seenRedirects.get(info.id) ?? new Set<string>();
            if (redirectSet.has(toUrl)) {
                return;
            }
            redirectSet.add(toUrl);
            seenRedirects.set(info.id, redirectSet);

            const taskInfo = activeTasks.find(t => t.info.id === info.id);
            const cuid = taskInfo ? taskInfo.gid.substring(1) : info.id.slice(0, 6);

            // log.info handles clearing progress line automatically
            log.info(`CUID#${cuid} - Redirecting to ${toUrl}`);
        };

        const cancelHandler = async (info: DownloadTaskInfo) => {
            // Don't log during shutdown - shutdownHandler handles it
            if (shuttingDown) {
                return;
            }

            const taskInfo = activeTasks.find(t => t.info.id === info.id);
            if (taskInfo && taskInfo.controlFile) {
                // Save progress so it can be resumed later
                await taskInfo.controlFile.save({
                    version: "1.0",
                    urls: info.urls,
                    filename: basename(taskInfo.outputPath),
                    outputPath: taskInfo.outputPath,
                    totalSize: info.totalSize,
                    downloadedBytes: info.progress.downloadedBytes,
                    segments: info.segments.map(seg => ({
                        index: seg.index,
                        startByte: seg.startByte,
                        endByte: seg.endByte,
                        downloadedBytes: seg.downloadedBytes,
                        status: seg.status,
                    })),
                    createdAt: new Date().toISOString(),
                    lastModified: new Date().toISOString(),
                });

                log.info(`Download GID${taskInfo.gid} not complete: ${taskInfo.outputPath}`);
            }
            seenRedirects.delete(info.id);
        };

        downloader.on(DownloaderEventName.Start, startHandler);
        downloader.on(DownloaderEventName.Progress, progressHandler);
        downloader.on(DownloaderEventName.Complete, completeHandler);
        downloader.on(DownloaderEventName.Cancel, cancelHandler);
        downloader.on(DownloaderEventName.Error, errorHandler);
        downloader.on(DownloaderEventName.Redirect, redirectHandler);
        downloader.on(DownloaderEventName.SegmentError, segmentErrorHandler);

        const shutdownHandler = async (_signal: string) => {
            if (shuttingDown) return;
            shuttingDown = true;

            // Stop progress bar
            log.stopProgress();

            log.info("Shutdown sequence commencing...");

            // Cancel all tasks and wait for them to save progress
            const cancelPromises: Promise<void>[] = [];

            for (const task of activeTasks) {
                const elapsed = task.startTime ? (Date.now() - task.startTime) / 1000 : 0;
                const avgSpeed =
                    elapsed > 0
                        ? formatBytes(task.info.progress.downloadedBytes / elapsed) + "/s"
                        : "--";

                log.info(
                    `Download GID${task.gid} incomplete - Average Speed: ${avgSpeed}, Path: ${task.outputPath}`
                );

                // Save progress before canceling
                const savePromise = task.controlFile.save({
                    version: "1.0",
                    urls: task.info.urls,
                    filename: basename(task.outputPath),
                    outputPath: task.outputPath,
                    totalSize: task.info.totalSize,
                    downloadedBytes: task.info.progress.downloadedBytes,
                    segments: task.info.segments.map(seg => ({
                        index: seg.index,
                        startByte: seg.startByte,
                        endByte: seg.endByte,
                        downloadedBytes: seg.downloadedBytes,
                        status: seg.status,
                    })),
                    createdAt: new Date().toISOString(),
                    lastModified: new Date().toISOString(),
                });

                cancelPromises.push(savePromise);
                task.task.cancel();
            }

            // Wait for all control files to be saved
            await Promise.all(cancelPromises);

            if (activeTasks.length > 0) {
                log.info("paradl will resume download if the transfer is restarted.");
            }

            process.exit(0);
        };

        process.on("SIGINT", shutdownHandler);

        try {
            for (const url of urls) {
                let filename = options.filename || extractFilename(url);
                const outputDir = options.output;
                let outputPath = resolve(outputDir, filename);
                let controlFile = new ControlFile(outputPath);

                let controlData = await controlFile.load();

                // If no control file at original path, check for incomplete downloads (numbered variants)
                if (!controlData && !options.filename) {
                    const incompleteDownload = await findIncompleteDownload(outputDir, filename);
                    if (incompleteDownload) {
                        filename = incompleteDownload.filename;
                        outputPath = resolve(outputDir, filename);
                        controlFile = incompleteDownload.controlFile;
                        controlData = await controlFile.load();

                        log.info(`Found incomplete download: ${filename}`);
                    }
                }

                if (controlData) {
                    const resumeUrls = controlData.urls.length > 0 ? controlData.urls : [url];
                    const resumeFilename = controlData.filename || filename;

                    if (controlData.urls.length === 0) {
                        log.warn("Resume metadata missing URL list; using CLI URL input.");
                    }

                    const totalSize =
                        controlData.totalSize ||
                        (controlData.segments.length > 0
                            ? controlData.segments.reduce(
                                  (sum: number, seg: Segment) =>
                                      sum + (seg.endByte - seg.startByte + 1),
                                  0
                              )
                            : 0);

                    const downloadedBytes = controlData.segments.reduce(
                        (sum, s) => sum + s.downloadedBytes,
                        0
                    );

                    let percent = "0";
                    if (totalSize > 0) percent = ((downloadedBytes / totalSize) * 100).toFixed(1);
                    else if (downloadedBytes > 0) percent = "100";

                    log.info(
                        `Resuming: ${formatBytes(downloadedBytes)}/${formatBytes(totalSize)}(${percent}%)`
                    );

                    const task = await downloader.download({
                        urls: resumeUrls,
                        filename: resumeFilename,
                        outputDir: outputDir,
                    });

                    activeTasks.push(
                        createActiveTask(task, resolve(outputDir, resumeFilename), controlFile)
                    );

                    await task.completionPromise;
                } else {
                    if (!options.filename) {
                        const availableFilename = await findAvailableFilename(outputPath);
                        if (availableFilename !== filename) {
                            outputPath = resolve(outputDir, availableFilename);

                            log.info(`File already exists. Renamed to ${outputPath}.`);
                        }
                        filename = availableFilename;
                    }

                    const task = await downloader.download({
                        urls: [url],
                        filename,
                        outputDir,
                    });

                    activeTasks.push(
                        createActiveTask(task, resolve(outputDir, filename), controlFile)
                    );

                    await task.completionPromise;
                }
            }
        } finally {
            downloader.off(DownloaderEventName.Start, startHandler);
            downloader.off(DownloaderEventName.Progress, progressHandler);
            downloader.off(DownloaderEventName.Complete, completeHandler);
            downloader.off(DownloaderEventName.Cancel, cancelHandler);
            downloader.off(DownloaderEventName.Error, errorHandler);
            downloader.off(DownloaderEventName.Redirect, redirectHandler);
            downloader.off(DownloaderEventName.SegmentError, segmentErrorHandler);
            process.off("SIGINT", shutdownHandler);
        }
    });

// Helper functions
function generateGID(): string {
    return (
        GID_PREFIX +
        Math.random()
            .toString(16)
            .slice(2, 2 + GID_LENGTH)
    );
}

function createActiveTask(
    task: DownloadTask,
    outputPath: string,
    controlFile: ControlFile
): ActiveTask {
    return {
        task,
        info: task.info,
        gid: generateGID(),
        startTime: Date.now(),
        outputPath,
        controlFile,
    };
}

program.parse();
