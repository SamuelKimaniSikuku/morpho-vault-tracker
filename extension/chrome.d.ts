// Narrow declarations for the Chrome APIs used by this extension.
interface ChromeEvent<T extends (...args: any[]) => any> { addListener(listener: T): void }
declare const chrome: {
  storage: {
    local: { get(keys?: string | string[] | null): Promise<Record<string, any>>; set(values: Record<string, unknown>): Promise<void> };
    onChanged: ChromeEvent<(changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void>;
  };
  runtime: {
    onInstalled: ChromeEvent<() => void>;
    onStartup: ChromeEvent<() => void>;
    onMessage: ChromeEvent<(message: unknown, sender: { id?: string }, respond: (response: unknown) => void) => boolean | undefined>;
    sendMessage(message: unknown): Promise<any>;
    getPlatformInfo(): Promise<unknown>;
    id: string;
  };
  alarms: {
    get(name: string): Promise<{ periodInMinutes?: number } | undefined>;
    create(name: string, options: { periodInMinutes: number; delayInMinutes?: number }): Promise<void>;
    onAlarm: ChromeEvent<(alarm: { name: string }) => void>;
  };
  action: { setBadgeText(options: { text: string }): Promise<void>; setBadgeBackgroundColor(options: { color: string }): Promise<void> };
  notifications: {
    getPermissionLevel(): Promise<"granted" | "denied">;
    create(options: { type: "basic"; iconUrl: string; title: string; message: string }): Promise<string>;
  };
};
