# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Project Overview

`paradl` is a TypeScript multipart downloader with CLI and library APIs. It provides resumable, segmented downloads with HTTP range requests, event-driven progress tracking, and persistent state management via `.paradl` control files.

**Core architecture**: Event-driven with separated concerns - network (HttpClient), storage (SegmentWriter/ControlFile), business logic (DownloadTask), and orchestration (Downloader).

## Build & Test Commands

- `bun run build` - Build using tsdown (outputs to dist/)
- `bun test` - Run tests using Bun's built-in test framework
- `bun test <file>` - Run a single test file
- `bun run dev` - Watch mode with tsdown
- `bun run format` - Format code with Prettier
- `bun run lint` - Check formatting with Prettier
- `bun typecheck` - Run TypeScript type checking

## Code Style Guidelines

### Imports

- Use `@/*` path aliases for internal imports (e.g., `@/core`, `@/storage`)
- Use `import type` for type-only imports (e.g., `import type { Segment } from "@/types"`)
- Import external packages directly (e.g., `import got from "got"`)

### Formatting

- Use Prettier for formatting (no custom config found, assume defaults)
- ES modules (`"type": "module"` in package.json)
- Follow existing patterns in the codebase for indentation and spacing

### Types

- TypeScript strict mode is enabled
- Always provide type annotations for function parameters and return types
- Use `interface` for object shapes (see types/index.ts)
- Use `Required<>` utility type for default configs with all properties
- Use `as` for type assertions only when necessary

### Naming Conventions

- Classes: PascalCase (e.g., `Downloader`, `DownloadTask`, `HttpClient`)
- Methods/Functions: camelCase (e.g., `download()`, `pause()`, `resume()`)
- Variables: camelCase (e.g., `downloadQueue`, `activeTasks`)
- Constants: UPPER_SNAKE_CASE (e.g., `DEFAULT_OPTIONS`)
- Enums: PascalCase (e.g., `DownloadTaskEventName`)
- Private methods: No underscore prefix (e.g., `downloadSegment()`, `updateProgress()`)

### Error Handling

- Use try/catch blocks for error handling
- Convert errors to Error instances via `toError(error, defaultMessage)` utility (see utils/common.ts)
- Use `error instanceof Error` checks before accessing error properties
- Prefer throwing descriptive Error objects over generic errors
- File operations: Use `ignoreFileNotFound()` helper to safely ignore ENOENT errors
- Check for ENOENT: `(error as { code: string }).code === "ENOENT"`
- **HttpClient error patterns:**
  - `supportsRangeRequests()`: Silently catches and returns `false`
  - `downloadSegment()`: Throws errors for caller to handle
  - `getFileSize()`: Throws on missing Content-Length header
- **Segment-level errors**: Caught individually, emitted as `segmentError` event; download continues with other segments

### File I/O Conventions

- **ALL** async file operations use `fs/promises` (never callback-style fs)
- CLI uses sync `existsSync()` ONLY for file availability checks (not for actual I/O)
- Directory creation: Always use `mkdir(path, { recursive: true })` to ensure parent dirs exist
- File handle pattern: Store as `FileHandle | null`, always close in `finally` block
- Delete operations: Always catch and ignore ENOENT with `ignoreFileNotFound()` helper
- File open modes: `"r+"` for existing files (resume), `"w"` for new files
- Memory management: Always null file handle references after closing

### Progress Calculation Formulas

- **Speed tracking**: Rolling average of last 10 samples to stabilize displayed speed
  ```typescript
  speedSamples.push(instantSpeed);
  if (samples.length > 10) samples.shift();
  avgSpeed = sum(samples) / samples.length;
  ```
- **ETA calculation**: Simple division, floored to nearest second
  ```typescript
  eta = Math.floor((totalBytes - downloadedBytes) / speed);
  ```
- **Progress clamping** (prevents display bugs):
  ```typescript
  downloadedBytes = Math.min(this.downloadedBytes, this.totalSize);
  percent = Math.min(percent, 100);
  ```

### Code Structure

- Separation of concerns: core (business logic), network (HTTP), storage (file I/O), config, utils, types, cli
- Use TypedEventEmitter for event-driven architecture
- Implement proper cleanup in async methods (e.g., stopAutoSaveLoop)
- Use modern ES features: optional chaining `?.`, nullish coalescing `??`

### Logging Patterns

- Log functions **return formatted strings**, don't print directly
- Timestamp format: `MM/DD HH:MM:SS` (from `date.toTimeString().split(" ")[0]`)
- Level tokens: Padded to `LOG_LEVEL_TOKEN_WIDTH` for alignment
- Colors: NOTICE/PROGRESS=cyan, WARNING/ERROR=default
- Progress line uses multiple colors: cyan(GID), green(progress), yellow(CN), magenta(DL), blue(ETA)
- CLI uses `\r\x1b[2K` for in-place terminal updates (clear line + carriage return)

### Testing

- Use Bun's built-in test framework
- Place tests in tests/unit/ and tests/integration/
- Run specific tests with `bun test <file>`
- See [Testing Patterns](#testing-patterns) section for detailed test setup patterns

### Asynchronous Patterns

- Use async/await for asynchronous operations
- Use arrow functions for callbacks and short functions
- Use for-await-of for async iteration over streams
- Store AbortController for cancellation support
- **Queue operations DON'T await** - enables parallel execution:
  ```typescript
  queue.add(() => this.downloadSegment(...));  // No await!
  await queue.onIdle();  // Wait for all queued tasks
  ```
- **Auto-save debouncing** with in-flight flag:
  ```typescript
  if (this.autoSaveInFlight) return;
  this.autoSaveInFlight = true;
  await saveProgress().finally(() => this.autoSaveInFlight = false);
  ```
- **Offset tracking** for streaming writes:
  ```typescript
  let offset = initialDownloadedBytes;
  onData: async (chunk) => {
      await writeSegmentChunk(index, offset, chunk);
      offset += chunk.length;  // Increment for next write
  }
  ```
- **waitForResume polling**: Checks every 100ms for `!isPaused || isCancelled`

### Memory Management

- Speed samples: Array grows to 10, then `shift()` oldest
- Event listeners: Cleaned up in `finally` blocks (prevents memory leaks)
- Timers: `stopAutoSaveLoop()` clears interval and nulls reference
- File handles: Always closed in `finally`, nulled after close
- Active tasks: Removed from Map on completion/error/cancel

### Config Files

- tsdown.config.ts - Build configuration
- tsconfig.json - TypeScript compiler options with @/\* path alias
- package.json - Scripts and dependencies

## Architecture Patterns

### Component Hierarchy

```
Downloader (orchestrator)
  ├─ PQueue (manages concurrent downloads)
  └─ DownloadTask[] (individual downloads)
      ├─ HttpClient (network layer)
      ├─ ChunkManager (segment management & persistence)
      │   ├─ SegmentWriter (low-level file I/O)
      │   └─ ControlFile (resume state)
      └─ PQueue (concurrent connections per server)
```

**Key responsibilities:**
- `Downloader`: Queue management, task orchestration, event forwarding
- `DownloadTask`: Download lifecycle, segment coordination, progress tracking
- `HttpClient`: HTTP operations (HEAD, GET with ranges), redirect handling
- `SegmentWriter`: File I/O operations (write segments, file allocation)
- `ControlFile`: Persist/load resume state to `.paradl` files
- `ChunkManager`: Segment state management, progress calculation, resume normalization (core component used by DownloadTask)

### Event System Architecture

**Two-level event forwarding:**
1. `DownloadTask` emits 10 event types (start, progress, segmentComplete, complete, error, etc.)
2. `Downloader` forwards all task events with task info prepended via `setupTaskEvents()`
3. Both extend `TypedEventEmitter<TEventMap>` for type-safe event handling

**Progress throttling logic:**
- Emits only when: percent change ≥1% OR 1 second elapsed OR forceEmit=true
- Prevents flooding event handlers during high-speed downloads
- Speed calculation: Rolling average of last 10 samples for stable ETA

**TypedEventEmitter pattern:**
```typescript
// Type-safe events with generic event map
class TypedEventEmitter<TEvents extends object> extends EventEmitter {
  on<K extends EventKey<TEvents>>(event: K, listener: EventListener<TEvents, K>): this
}
```

### Concurrency Model

**Dual PQueue strategy:**
- **Downloader level**: `downloadQueue` limits concurrent downloads (default: 5)
- **DownloadTask level**: `queue` limits connections per server (default: 1 to avoid bans)
- Segments added to queue without await for parallel execution: `queue.add(() => downloadSegment())`
- Wait for completion via `queue.onIdle()`

**Multi-source URL rotation:**
- Round-robin through URLs array for load distribution
- Each segment uses `urls[urlIndex++ % urls.length]`

### State Management

**Three-layer state architecture:**
1. **Public state** (`DownloadTaskInfo`): Exposed to users via events/API
2. **Segment state**: Each segment tracks `pending → downloading → completed/failed`
3. **Persistent state**: JSON in `.paradl` control files (version, urls, segments, timestamps)

**Resume flow:**
1. `ChunkManager.initialize()` checks for `.paradl` control file
2. Loads segments, validates totalSize matches
3. **Normalizes interrupted state**: "downloading" → "pending" (crashed downloads)
4. Clamps downloadedBytes to segment boundaries
5. If `alwaysResume=true` and control file missing, throws error (strict mode)

**Critical state update semantics:**
- `updateSegmentProgress(index, bytes)` SETS value (not ADD)
- Delta calculated internally: `delta = bytes - segment.downloadedBytes`
- Progress validation: `downloadedBytes = Math.min(segment.downloadedBytes, fullSize)`

**Auto-save debouncing:**
- Control file saved every `autoSaveInterval` seconds (default: 60)
- `autoSaveInFlight` flag prevents concurrent saves
- Control file deleted on successful completion, preserved on cancel/error

## API Patterns

### Library Usage

**download() vs downloadAndWait():**
- `download()` returns DownloadTask immediately (queued, non-blocking)
- `downloadAndWait()` awaits completion (convenience method)

**Completion promise cast requirement:**
```typescript
// download() stores promise on task via cast (workaround for queued execution)
const task = await downloader.download({ urls, filename });
const taskWithPromise = task as DownloadTask & { completionPromise: Promise<void> };
await taskWithPromise.completionPromise;
```

**Bulk operations:**
- `pauseAll()`, `resumeAll()`, `cancelAll()` operate on all active tasks

### CLI Patterns

- **GID tracking**: 6-char hex IDs (`#a3b4c5`) for user-friendly task display
- **SIGINT handler**: Saves state on Ctrl+C, shows status table
- **File renaming**: Auto-renames to avoid overwrites (`file.1.ext`, `file.2.ext`)
- **Terminal control**: Uses `\r\x1b[2K` for in-place progress updates
- **Resume detection**: Automatically loads `.paradl` control files

## Non-Obvious Project Details

### Control File Extension Mismatch

- ControlFile uses `.paradl` extension (not `.control` as suggested by naming)
- Constructor appends `.paradl` suffix to filename
- Resume files stored in output directory alongside downloads

### Path Alias

- Use `@/*` imports for src directory (e.g., `@/core`, `@/storage`)
- Configured in tsconfig.json paths

### ChunkManager Usage

- ChunkManager is a **separate class** extensively used by DownloadTask
- Key methods: `initialize()`, `getNextPendingSegment()`, `writeSegmentChunk()`, `updateSegmentProgress()`, `markSegmentCompleted()`
- Chunk sizes parsed by parseSegmentSize() in defaults.ts

### DownloadTask Completion Promise

- Stores `completionPromise` on itself for async access
- Cast required: `(task as DownloadTask & { completionPromise: Promise<void> }).completionPromise`

### tsdown External Dependencies

- tsdown uses default behavior - all dependencies in package.json are external (not bundled)
- **Unused dependencies**: `ora` and `common-tags` are in package.json but never imported (potential cleanup targets)
- Used dependencies: got, p-queue, commander, chalk

### File Allocation Methods

- `none` - No pre-allocation
- `trunc` - Truncate to size (default)
- `prealloc` - Write zeros to allocate space (slow but compatible)
- `falloc` - Falls back to truncate (native fallocate not available)

### HttpClient Range Request Detection

- Uses HEAD request with `Range: bytes=0-0` header
- Returns true if status code is 206

### Segment Size Parsing

- Accepts number (bytes) or string with unit (e.g., "1MB", "512KB")
- Units: B, KB, MB, GB (case-insensitive)
- See `src/config/defaults.ts:parseSegmentSize()`

### Event System

- Downloader and DownloadTask extend TypedEventEmitter
- Event types defined in DownloadTaskEventMap and DownloaderEventMap
- Forward events from DownloadTask to Downloader

### Download Lifecycle

1. DownloadTask created with options
2. start() determines single file or segmented download
3. Segments downloaded concurrently via PQueue
4. ChunkManager writes segments to file
5. Progress updates via TypedEventEmitter
6. Completion or cancellation triggers cleanup

## Testing Patterns

### Integration Test Setup

**Mock HTTP server capabilities:**
- Supports HEAD requests with Content-Length
- Range request detection (returns 206 for partial content)
- Proper Content-Range headers
- Partial content serving via `parseRange()` helper

**Test patterns:**
- Uses `tmpdir()` for test isolation
- Cleanup in `afterEach` hooks
- Real file I/O (no mocking storage layer)
- HTTP server on random port for parallel test execution

**Key test scenarios:**
1. Complete download validation (file content matches)
2. Resume from "downloading" state (tests normalization)
3. Strict resume failure (`alwaysResume` enforcement)
4. Network failure handling and status updates

## Common Pitfalls

### Completion Promise Casting

The `download()` method returns a task immediately (queued), but stores the actual completion promise via cast. Always use `downloadAndWait()` when you need to await completion, or cast the task:

```typescript
const task = task as DownloadTask & { completionPromise: Promise<void> };
```

### Progress Update Semantics

`updateSegmentProgress(index, bytes)` **sets** the value, it doesn't add:
```typescript
// CORRECT internal implementation
const delta = bytes - segment.downloadedBytes;
segment.downloadedBytes = bytes;  // SET, not +=
this.downloadedBytes += delta;
```

### Pause/Resume Polling

- Pause sets `isPaused=true` and status="paused"
- Resume detection: `waitForResume()` polls every 100ms
- Cancel uses `AbortController.abort()` for immediate termination

### File Allocation Tradeoffs

- `none`: No pre-allocation (risky - disk full during download)
- `trunc`: Truncate to size (fast, default, reserves inode)
- `prealloc`: Write zeros (slow, guarantees space)
- `falloc`: Falls back to trunc (native fallocate not available in Node.js)

### Range Request Support Detection

Uses HEAD request with `Range: bytes=0-0` header:
- 206 response = server supports range requests (enable segmentation)
- Other status codes = single-threaded download only

### Control File Lifecycle

- Created on first save (auto-save interval or explicit save)
- Deleted on successful completion
- Preserved on cancel/error for resume capability
- Extension is `.paradl` not `.control`

### Important Constants

- `PROGRESS_UPDATE_MIN_PERCENT_DELTA = 1` (1% minimum change)
- `PROGRESS_UPDATE_MIN_INTERVAL_MS = 1000` (1 second minimum interval)
- `SPEED_SAMPLE_COUNT = 10` (rolling average window)
- `GID_LENGTH = 6` (hex chars for CLI task IDs)
- `CONTROL_FILE_EXTENSION = ".paradl"`
- `DEFAULT_SEGMENT_SIZE_BYTES = 20 * 1024 * 1024` (20MB)
- `PREALLOC_BUFFER_SIZE = 1024 * 1024` (1MB for prealloc writes)
- `DEFAULT_TIMEOUT_MS = 30000` (30 seconds)
- `DEFAULT_RETRIES = 3`
- `MAX_REDIRECTS = 5`

### Type Guards & Validation

```typescript
// Error type guard
error instanceof Error

// ENOENT guard
(error as { code: string }).code === "ENOENT"

// Number option validation (CLI)
const parsed = parseInt(value, 10);
if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(...)

// Segment size parsing
/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)$/i

// Range header parsing (integration tests)
/^bytes=(\d+)-(\d*)$/
```
