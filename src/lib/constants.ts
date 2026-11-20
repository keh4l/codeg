export const CONNECTION_IDLE_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
export const IDLE_SWEEP_INTERVAL_MS = 60 * 1000 // 1 minute
// Keepalive cadence for backend idle-sweep protection. Must be tighter
// than the backend's CODEG_ACP_IDLE_TIMEOUT_SECS (default 900s desktop /
// 1800s server) so each open tab gets regular touches — 30s gives ample
// safety margin under network jitter and background tab throttling.
export const CONNECTION_KEEPALIVE_INTERVAL_MS = 30 * 1000 // 30 seconds
