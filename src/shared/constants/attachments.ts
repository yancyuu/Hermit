/**
 * Attachment file categorization and MIME type helpers.
 *
 * Browser MIME types are unreliable:
 *   .ts → "video/mp2t", .json → "application/json", .go/.rs/.yaml → ""
 * So categorization is ALWAYS by file extension (primary), with browser MIME
 * used only as a fallback for images.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** Extensions recognized as image files (fallback when browser MIME is empty). */
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);

/** Extensions recognized as text-based files → sent as `document` block with `text/plain`. */
export const TEXT_FILE_EXTENSIONS = new Set([
  // Data
  'json',
  'jsonl',
  'txt',
  'md',
  'mdx',
  'csv',
  'tsv',
  // JavaScript / TypeScript
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  // Other languages
  'py',
  'go',
  'rs',
  'java',
  'kt',
  'rb',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'swift',
  'dart',
  'php',
  'lua',
  'scala',
  'ex',
  'exs',
  // Web
  'html',
  'css',
  'scss',
  'less',
  'vue',
  'svelte',
  // Config / markup
  'xml',
  'yaml',
  'yml',
  'toml',
  'ini',
  'cfg',
  'conf',
  // Shell
  'sh',
  'bash',
  'zsh',
  'fish',
  // Query / schema
  'sql',
  'graphql',
  'gql',
  'proto',
  // Misc text
  'env',
  'log',
  'rst',
  'diff',
  'patch',
  // Known filenames that happen to equal their "extension" when split on '.'
  'dockerfile',
  'makefile',
  'gitignore',
  'dockerignore',
  'editorconfig',
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FileCategory = 'image' | 'pdf' | 'text' | 'unsupported';

// ---------------------------------------------------------------------------
// Categorization
// ---------------------------------------------------------------------------

/**
 * Categorize a `File` by its **extension** (primary) — browser MIME is
 * unreliable for anything other than images.
 */
export function categorizeFile(file: File): FileCategory {
  // 1. Browser MIME is reliable for images
  if (IMAGE_MIME_TYPES.has(file.type)) return 'image';

  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';

  // 2. Extension-based checks
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'; // fallback for empty MIME
  if (ext === 'pdf') return 'pdf';
  if (TEXT_FILE_EXTENSIONS.has(ext)) return 'text';

  // 3. Special filenames / patterns
  const baseName = file.name.toLowerCase();
  if (baseName.startsWith('.env')) return 'text'; // .env.local, .env.production, etc.

  return 'unsupported';
}

// ---------------------------------------------------------------------------
// MIME helpers
// ---------------------------------------------------------------------------

const IMAGE_EXT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

/**
 * Return the MIME type that should be stored in `AttachmentPayload.mimeType`
 * (used by the backend to choose the correct content block type).
 */
export function getEffectiveMimeType(file: File): string {
  const cat = categorizeFile(file);

  if (cat === 'image') {
    if (file.type && IMAGE_MIME_TYPES.has(file.type)) return file.type;
    // Fallback when browser returns empty MIME for an image extension
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    return IMAGE_EXT_TO_MIME[ext] ?? 'image/png';
  }
  if (cat === 'pdf') return 'application/pdf';
  if (cat === 'text') return 'text/plain';

  return file.type || 'application/octet-stream';
}

// ---------------------------------------------------------------------------
// MIME type guards (used by backend routing & preview components)
// ---------------------------------------------------------------------------

export function isImageMime(mime: string): boolean {
  return IMAGE_MIME_TYPES.has(mime);
}

export function isPdfMime(mime: string): boolean {
  return mime === 'application/pdf';
}

export function isTextDocMime(mime: string): boolean {
  return mime === 'text/plain';
}

export function isNativeAttachmentMime(mime: string): boolean {
  return isImageMime(mime) || isPdfMime(mime) || isTextDocMime(mime);
}
