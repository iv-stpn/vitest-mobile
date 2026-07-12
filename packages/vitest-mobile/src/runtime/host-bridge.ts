/**
 * Host-action bridge — device → pool RPC for actions that must run on the host.
 *
 * Synthesized `MotionEvent`s dispatched in-process (`dispatchTouchEvent`) don't
 * reliably trigger React Native's touch emitter on Android headless emulators:
 * they bypass the InputDispatcher's touch-session setup, so onPress fires only
 * some of the time. `adb shell input tap` injects through the full InputManager
 * pipeline (the same path a real finger takes), so it's reliable.
 *
 * The device can't run `adb` itself, so a tap is an RPC: the device posts a
 * `tapRequest` with screen-pixel coordinates, the pool runs `adb shell input
 * tap`, and replies `tapResponse`. Pending requests are tracked by `requestId`.
 */

import { Platform } from 'react-native';
import type { DevicePoolConnection } from './connection';

interface PendingRequest {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let connection: DevicePoolConnection | null = null;
const pending = new Map<string, PendingRequest>();

const TIMEOUT_MS = 15_000;

export function setHostBridgeConnection(conn: DevicePoolConnection | null): void {
  connection = conn;
}

function makeRequest(message: Record<string, unknown>): Promise<void> {
  if (!connection || !connection.isOpen()) {
    return Promise.reject(new Error('[host-bridge] Not connected to pool'));
  }
  const requestId = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending.delete(requestId)) {
        reject(new Error(`[host-bridge] Request ${requestId} timed out after ${TIMEOUT_MS}ms`));
      }
    }, TIMEOUT_MS) as ReturnType<typeof setTimeout> & { unref?: () => void };
    timer.unref?.();
    pending.set(requestId, { resolve, reject, timer });
    connection!.post({ ...message, data: { ...(message.data as object), requestId } });
  });
}

/**
 * Resolve a pending request when the pool replies. Called from the runtime's
 * pool-message handler for `tapResponse` / `typeTextResponse`.
 */
export function resolveHostResponse(requestId: string, error?: string): void {
  const entry = pending.get(requestId);
  if (!entry) return;
  pending.delete(requestId);
  clearTimeout(entry.timer);
  if (error) {
    entry.reject(new Error(error));
  } else {
    entry.resolve();
  }
}

/** Back-compat alias used by the runtime's tapResponse handler. */
export const resolveTapResponse = resolveHostResponse;

/** Request the host to inject a tap at the given screen-pixel coordinates. */
export function requestHostTap(x: number, y: number): Promise<void> {
  return makeRequest({ type: 'tapRequest', data: { x, y } });
}

/** Request the host to type text into the currently-focused field via the IME. */
export function requestHostTypeText(text: string): Promise<void> {
  return makeRequest({ type: 'typeTextRequest', data: { text } });
}

/**
 * Whether the host-bridge should be used for interactions. The adb-based
 * tap/type path is Android-only — iOS keeps using its in-process TouchInjector
 * (the pool's tapRequest handler rejects non-Android platforms).
 */
export function isHostBridgeReady(): boolean {
  return Platform.OS === 'android' && connection !== null && connection.isOpen();
}
