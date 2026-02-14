import chalk from "chalk";
import { CONTROL_FILE_EXTENSION, LOG_LEVEL_TOKEN_WIDTH } from "./constants";

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    SILENT = 4,
}

export interface ProgressOptions {
    gid: string;
    progressText: string;
    connections: number;
    speedText: string;
    etaText: string;
}

export class Logger {
    private currentLevel: LogLevel = LogLevel.INFO;
    private lastLineWasProgress = false;

    /**
     * Set the current log level
     */
    setLevel(level: LogLevel): void {
        this.currentLevel = level;
    }

    /**
     * Get the current log level
     */
    getLevel(): LogLevel {
        return this.currentLevel;
    }

    private getTimestamp(): string {
        const date = new Date();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        const timeStr = date.toTimeString().split(" ")[0];
        return `${month}/${day} ${timeStr}`;
    }

    private formatLevelToken(levelLabel: string, colorFn: (str: string) => string): string {
        return colorFn(`[${levelLabel}]`.padEnd(LOG_LEVEL_TOKEN_WIDTH));
    }

    private clearProgress(stream: NodeJS.WriteStream): void {
        if (this.lastLineWasProgress) {
            // Clear the current line
            stream.write("\r\x1b[2K");
            this.lastLineWasProgress = false;
        }
    }

    private write(
        stream: NodeJS.WriteStream,
        levelLabel: string,
        colorFn: (str: string) => string,
        message: string
    ): void {
        this.clearProgress(stream);
        const ts = this.getTimestamp();
        const token = this.formatLevelToken(levelLabel, colorFn);
        stream.write(`${ts} ${token} ${message}\n`);
    }

    /**
     * Log a debug message
     */
    debug(message: string): void {
        if (this.currentLevel <= LogLevel.DEBUG) {
            this.write(process.stdout, "DEBUG", chalk.magenta, message);
        }
    }

    info(message: string): void {
        if (this.currentLevel <= LogLevel.INFO) {
            this.write(process.stdout, "NOTICE", chalk.cyan, message);
        }
    }

    success(message: string): void {
        if (this.currentLevel <= LogLevel.INFO) {
            this.write(process.stdout, "SUCCESS", chalk.green, message);
        }
    }

    warn(message: string): void {
        if (this.currentLevel <= LogLevel.WARN) {
            this.write(process.stderr, "WARNING", chalk.yellow, message);
        }
    }

    error(message: string): void {
        if (this.currentLevel <= LogLevel.ERROR) {
            this.write(process.stderr, "ERROR", chalk.red, message);
        }
    }

    /**
     * Update the progress bar (only if level <= INFO)
     */
    progress(options: ProgressOptions): void {
        if (this.currentLevel > LogLevel.INFO) return;

        const ts = this.getTimestamp();
        const levelToken = this.formatLevelToken("PROGRESS", chalk.cyan);

        const line = [
            `${ts} ${levelToken}`,
            chalk.cyan(options.gid),
            chalk.green(options.progressText),
            chalk.yellow(`CN:${options.connections}`),
            chalk.magenta(`DL:${options.speedText}`),
            chalk.blue(`ETA:${options.etaText}`),
        ].join(" ");

        process.stdout.write(`\r\x1b[2K${line}`);
        this.lastLineWasProgress = true;
    }

    /**
     * Finalize the progress bar line (only if it was active)
     */
    stopProgress(): void {
        if (this.lastLineWasProgress) {
            process.stdout.write("\n");
            this.lastLineWasProgress = false;
        }
    }
}

// Singleton instance
export const log = new Logger();

// Re-export constants
export { CONTROL_FILE_EXTENSION };

// Helper to parse string to LogLevel
const LOG_LEVEL_MAP: Record<string, LogLevel> = {
    debug: LogLevel.DEBUG,
    info: LogLevel.INFO,
    warn: LogLevel.WARN,
    error: LogLevel.ERROR,
    silent: LogLevel.SILENT,
};

export function parseLogLevel(level: string): LogLevel {
    return LOG_LEVEL_MAP[level.toLowerCase()] ?? LogLevel.INFO;
}

export function getLogTimestamp(date: Date = new Date()): string {
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const timeStr = date.toTimeString().split(" ")[0];
    return `${month}/${day} ${timeStr}`;
}
