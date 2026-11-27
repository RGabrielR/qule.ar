export const ONLINE_STATUS_OPTIONS = ["always", "connected", "never"] as const;
export type OnlineStatus = (typeof ONLINE_STATUS_OPTIONS)[number];
export const DEFAULT_ONLINE_STATUS = "connected" satisfies OnlineStatus;
