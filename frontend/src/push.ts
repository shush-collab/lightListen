import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { api } from "@/src/api/client";
import { storage } from "@/src/utils/storage";

const PROMPTED_KEY = "lightlisten.push.prompted";

export type PushOutcome = "granted" | "denied" | "blocked" | "unsupported";

export const pushSupported = Platform.OS !== "web";

export async function getPushStatus(): Promise<{ granted: boolean; canAskAgain: boolean }> {
  if (!pushSupported) return { granted: false, canAskAgain: false };
  try {
    const { status, canAskAgain } = await Notifications.getPermissionsAsync();
    return { granted: status === "granted", canAskAgain };
  } catch {
    return { granted: false, canAskAgain: false };
  }
}

async function registerToken(): Promise<void> {
  const token = await Notifications.getDevicePushTokenAsync();
  await api.registerPush({
    platform: Platform.OS,
    device_token: String(token.data),
  });
}

/** Re-registers on every app open (device tokens rotate). Never prompts. */
export async function refreshPushRegistration(): Promise<void> {
  if (!pushSupported) return;
  try {
    const { granted } = await getPushStatus();
    if (!granted) return;
    await registerToken();
  } catch {
    /* non-blocking */
  }
}

/** Contextual opt-in — only call after the user did something notification-worthy. */
export async function enablePush(): Promise<PushOutcome> {
  if (!pushSupported) return "unsupported";
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.status === "granted") {
      await registerToken();
      return "granted";
    }
    if (!current.canAskAgain) return "blocked";

    const asked = await Notifications.requestPermissionsAsync();
    await storage.setItem(PROMPTED_KEY, "1");
    if (asked.status !== "granted") return asked.canAskAgain ? "denied" : "blocked";
    await registerToken();
    return "granted";
  } catch {
    return "denied";
  }
}

export async function hasBeenPrompted(): Promise<boolean> {
  return (await storage.getItem<string>(PROMPTED_KEY, "")) === "1";
}
