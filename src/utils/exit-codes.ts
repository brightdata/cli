// Exit codes are cross-command public API for shell users.
// 0 success · 1 error (fail() and catch-all paths) · 3 result not ready yet
const EXIT = {
    OK: 0,
    ERROR: 1,
    NOT_READY: 3,
} as const;

export {EXIT};
