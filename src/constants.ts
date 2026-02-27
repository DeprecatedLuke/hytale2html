import type { Viewport } from "./types.js";

export const DEFAULT_VIEWPORT: Viewport = { width: 1920, height: 1080 };
export const FONT_READY_TIMEOUT_MS = 500;
export const HIRES_THRESHOLD = 400;

export const SHARED_TEXTURES_DIR = "Shared";
export const SHARED_TEXTURE_PREFIX = "t";

// Resource-level dedupe. We dedupe exact matches by content hash and optionally allow
// extremely small pixel-level differences ("sweet spot") to collapse near-identical
// resources into a single shared texture.
export const DEDUPE_SIMILARITY_THRESHOLD = 0.999; // 99.9%
export const DEDUPE_MAX_MISMATCH_PIXELS = 64; // Cap mismatches for very large textures
export const DEDUPE_CHANNEL_TOLERANCE = 4; // 0-255 per-channel (premultiplied RGBA)
export const DEDUPE_ALPHA_IGNORE_BELOW = 4; // Treat both pixels as equal if both alpha <= this
export const DEDUPE_FINGERPRINT_SIZE = 16; // Downsample grid for candidate bucketing
