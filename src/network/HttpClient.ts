import type { Segment } from "@/types";
import got from "got";

interface HttpClientOptions {
    timeout: number;
    retries: number;
    headers?: Record<string, string>;
    onRedirect?: (fromUrl: string, toUrl: string) => void;
}

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
        });

        let downloaded = 0;

        for await (const chunk of stream) {
            await onData(Buffer.from(chunk));
            downloaded += chunk.length;
            onProgress(downloaded);
        }
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
        });

        let downloaded = 0;

        for await (const chunk of stream) {
            await onData(Buffer.from(chunk));
            downloaded += chunk.length;
            onProgress(downloaded);
        }
    }
}
