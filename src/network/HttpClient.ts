import type { Segment } from "@/types";
import got from "got";

interface HttpClientOptions {
    timeout: number;
    retries: number;
    headers?: Record<string, string>;
    onRedirect?: (fromUrl: string, toUrl: string) => void;
}

type DownloadStream = AsyncIterable<Buffer> & {
    on(event: "error", listener: (error: unknown) => void): unknown;
};

export class HttpClient {
    private client: typeof got;

    constructor(options: HttpClientOptions) {
        this.client = got.extend({
            retry: {
                limit: options.retries,
                methods: ["GET", "HEAD"],
            },
            timeout: {
                request: options.timeout,
                connect: 10000,
            },
            headers: options.headers,
            followRedirect: true,
            maxRedirects: 5,
            mutableDefaults: true,
            hooks: {
                beforeRedirect: [
                    (nextOptions, response) => {
                        const fromUrl = String(response.url ?? "");
                        const toUrl = String(nextOptions.url ?? "");
                        if (fromUrl && toUrl && fromUrl !== toUrl)
                            options.onRedirect?.(fromUrl, toUrl);
                    },
                ],
            },
        });
    }

    async getFileSize(url: string, signal?: AbortSignal): Promise<number> {
        const response = await this.client.head(url, { signal });
        const contentLength = response.headers["content-length"];
        if (!contentLength) {
            throw new Error("Content-Length header not available");
        }
        return parseInt(contentLength, 10);
    }

    async supportsRangeRequests(url: string, signal?: AbortSignal): Promise<boolean> {
        return this.client
            .head(url, {
                signal,
                headers: {
                    Range: "bytes=0-0",
                },
            })
            .then(response => response.statusCode === 206)
            .catch(() => false);
    }

    async downloadSegment(
        url: string,
        segment: Segment,
        signal: AbortSignal,
        onData: (chunk: Buffer) => Promise<void> | void,
        onProgress: (bytes: number) => void
    ): Promise<void> {
        const startByte = segment.startByte + segment.downloadedBytes;
        const endByte = segment.endByte;

        const stream = this.client.get(url, {
            headers: {
                Range: `bytes=${startByte}-${endByte}`,
            },
            signal,
            decompress: false,
            throwHttpErrors: false,
            isStream: true,
        }) as unknown as DownloadStream;
        await this.consumeStream(stream, signal, onData, onProgress);
    }

    async downloadFile(
        url: string,
        signal: AbortSignal,
        onData: (chunk: Buffer) => Promise<void> | void,
        onProgress: (bytes: number) => void
    ): Promise<void> {
        const stream = this.client.get(url, {
            signal,
            decompress: false,
            throwHttpErrors: false,
            isStream: true,
        }) as unknown as DownloadStream;
        await this.consumeStream(stream, signal, onData, onProgress);
    }

    private async consumeStream(
        stream: DownloadStream,
        signal: AbortSignal,
        onData: (chunk: Buffer) => Promise<void> | void,
        onProgress: (bytes: number) => void
    ): Promise<void> {
        let streamError: Error | null = null;

        // Keep an error listener to prevent unhandled stream errors, but only ignore aborts.
        stream.on("error", (error: unknown) => {
            if (HttpClient.isAbortError(error, signal)) return;
            streamError = error instanceof Error ? error : new Error(String(error));
        });

        let downloaded = 0;

        try {
            for await (const chunk of stream) {
                await onData(Buffer.from(chunk));
                downloaded += chunk.length;
                onProgress(downloaded);
            }
        } catch (error) {
            if (HttpClient.isAbortError(error, signal)) return;
            throw error;
        }

        if (streamError) throw streamError;
    }

    private static isAbortError(error: unknown, signal: AbortSignal): boolean {
        if (signal.aborted) return true;
        if (!(error instanceof Error)) return false;

        const maybeCode = (error as { code?: string }).code;
        return (
            error.name === "AbortError" || maybeCode === "ABORT_ERR" || maybeCode === "ERR_CANCELED"
        );
    }
}
