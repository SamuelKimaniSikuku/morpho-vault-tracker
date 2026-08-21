export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  if (!notificationsSupported()) return "unsupported";
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return "denied";
  return Notification.requestPermission();
}

export interface FireResult {
  attempted: boolean;
  error?: string;
}

/**
 * Fires an OS notification. Returns whether the browser call itself
 * succeeded (no thrown error) - that's distinct from whether the OS
 * actually displayed anything, which the page has no way to observe
 * (Focus/DND mode and per-app notification style settings can silently
 * swallow a "successful" call). Callers should pair this with a visible
 * in-page confirmation so users can tell "the code fired" apart from
 * "the OS ate it."
 */
export function fireNotification(title: string, body: string): FireResult {
  if (!notificationsSupported()) return { attempted: false, error: "Notifications not supported in this browser." };
  if (Notification.permission !== "granted") {
    return { attempted: false, error: `Permission is "${Notification.permission}", not granted.` };
  }
  try {
    const n = new Notification(title, { body });
    n.onerror = () => {
      // Fires asynchronously if the OS/browser rejects showing it after all.
      console.warn("Notification failed to display after being accepted by the browser.");
    };
    return { attempted: true };
  } catch (err) {
    return { attempted: false, error: err instanceof Error ? err.message : "Unknown error constructing Notification." };
  }
}
