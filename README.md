# paradl

`paradl` is a TypeScript multipart downloader with:

- a CLI (`paradl`) for direct use
- a library API (`Downloader`) for app integration

It exists to provide resumable, segmented downloads with clear progress events and practical defaults.

## How it works

1. A file is split into segments (`split` + `segmentSize`).
2. Segments are downloaded with HTTP range requests.
3. Progress is tracked per segment and merged into task progress.
4. Resume metadata is saved to a sidecar control file: `<output-file>.paradl`.
5. On restart, the downloader loads the control file and continues incomplete segments.

## Installation

### Use as a CLI

```bash
npm i -g @amrkmn/paradl
# or
bun add -g @amrkmn/paradl
```

### Use as a library

```bash
npm i @amrkmn/paradl
# or
bun add @amrkmn/paradl
```

## CLI usage

```bash
paradl <urls...> [options]
```

Examples:

```bash
# Basic download
paradl https://example.com/file.zip

# Custom output directory and filename
paradl https://example.com/file.zip -o ./downloads -f myfile.zip

# Tune parallelism and split behavior
paradl https://example.com/file.zip -j 3 -s 8 -x 2 -k 10MB
```

Key options:

- `-o, --output <dir>` output directory (default: `./downloads`)
- `-f, --filename <name>` output filename
- `-j, --max-concurrent-downloads <n>` concurrent tasks (default: `5`)
- `-s, --split <n>` segment count target per download (default: `5`)
- `-x, --max-connection-per-server <n>` connections per server per download (default: `1`)
- `-k, --segment-size <size>` minimum segment size (`B|KB|MB|GB`, default: `20MB`)
- `--no-resume` disable resume
- `--auto-save-interval <sec>` control file autosave interval (default: `60`)
- `--no-always-resume` allow restart from scratch if resume state is missing
- `-a, --allocation <method>` file allocation (`none|trunc|prealloc|falloc`, default: `trunc`)
- `--log-level <level>` set log level (`debug|info|warn|error|silent`, default: `info`)
- `-v, --verbose` alias for `--log-level debug`

## Library usage

```ts
import { Downloader } from "@amrkmn/paradl";

const downloader = new Downloader({
  split: 5,
  maxConcurrentDownloads: 5,
  maxConnectionsPerServer: 1,
  segmentSize: "20MB",
  timeout: 30000,
  retries: 3,
  fileAllocation: "trunc",
  resumeDownloads: true,
  autoSaveInterval: 60,
  alwaysResume: true,
});

downloader.on("progress", (_info, progress) => {
  console.log(progress.percent.toFixed(1) + "%");
});

const task = downloader.download({
  urls: ["https://example.com/file.zip"],
  filename: "file.zip",
  outputDir: "./downloads",
});

await task.completionPromise;
console.log(task.info.status);
```

You can also use `downloadAndWait(...)` for a simpler one-call flow.

## Configuration defaults

Default downloader settings:

- `split: 5`
- `maxConcurrentDownloads: 5`
- `maxConnectionsPerServer: 1`
- `segmentSize: 20MB`
- `timeout: 30000`
- `retries: 3`
- `retryDelay: 1000`
- `resumeDownloads: true`
- `autoSaveInterval: 60`
- `alwaysResume: true`
- `fileAllocation: "trunc"`

## Auto-resume

The CLI automatically detects incomplete downloads in the output directory:

1. On startup, it checks for `.paradl` control files matching the target filename.
2. If found, it automatically resumes the download from where it left off.
3. Supports numbered variants (e.g., `file.1.zip`, `file.2.zip`) for renamed files.

This works even if you restart the CLI without specifying a filename - it will find the most recent incomplete download automatically.

## Important technical details and assumptions

- Resume state is stored as `<target-file>.paradl`.
- Resume depends on range request support from the server.
- If a control file is missing and `alwaysResume` is enabled, resume is treated as an error.
- CLI removes control files after successful completion.
- Existing target filenames are auto-renamed by CLI (`name.1.ext`, `name.2.ext`, ...).
- Redirect events are exposed (`redirect`) and logged in CLI output.

## Event model

Downloader emits typed events:

- `start`
- `progress`
- `segment`
- `segmentError`
- `redirect`
- `pause`
- `resume`
- `cancel`
- `complete`
- `error`

String literal event names are fully typed (autocomplete on `.on(...)`).

## Project structure

```text
src/
  cli/         # CLI entry and terminal output
  core/        # Downloader, task orchestration, chunk management
  network/     # HTTP client and redirect hooks
  storage/     # Control file and segmented file writing
  types/       # Public types and event names/maps
  utils/       # Logger and typed EventEmitter wrapper
tests/
  unit/        # Unit tests
  integration/ # End-to-end behavior tests
```

## Development

```bash
bun install
bun run build
bun test
bun run lint
bun run typecheck
```
