/** Small constants shared by services and routes. */

/** Title of a conversation until the first question renames it. */
export const DEFAULT_CONVERSATION_TITLE = 'New conversation';

/** Auto titles are cut to this many characters. */
export const AUTO_TITLE_CHARS = 60;

/** GET /api/workspaces/:id updates lastOpenedAt at most this often. */
export const LAST_OPENED_THROTTLE_MS = 60_000;
