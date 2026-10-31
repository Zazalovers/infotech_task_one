export interface HeartbeatPinger {
  ping(): Promise<void>;
}
