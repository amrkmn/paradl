/**
 * Application-wide constants
 */

// Progress reporting thresholds
export const PROGRESS_UPDATE_MIN_PERCENT_DELTA = 1; // Minimum percent change to emit progress
export const PROGRESS_UPDATE_MIN_INTERVAL_MS = 1000; // Minimum time between progress emissions (ms)

// Speed calculation
export const SPEED_SAMPLE_COUNT = 10; // Number of speed samples to average
export const SPEED_SAMPLE_WINDOW_MS = 1000; // Speed calculation window (ms)

// CLI display constants
export const GID_LENGTH = 6; // Number of hex characters in GID (excluding # prefix)
export const GID_PREFIX = "#"; // GID prefix character

// File system constants
export const CONTROL_FILE_EXTENSION = ".paradl"; // Control file extension
export const DEFAULT_SEGMENT_SIZE_BYTES = 20 * 1024 * 1024; // 20MB default segment size

// Buffer sizes
export const PREALLOC_BUFFER_SIZE = 1024 * 1024; // 1MB buffer for pre-allocation

// Network constants
export const DEFAULT_TIMEOUT_MS = 30000; // Default network timeout (30s)
export const DEFAULT_RETRIES = 3; // Default retry attempts
export const MAX_REDIRECTS = 5; // Maximum HTTP redirects to follow

// Logging
export const LOG_LEVEL_TOKEN_WIDTH = "[PROGRESS]".length; // Width of log level tokens
