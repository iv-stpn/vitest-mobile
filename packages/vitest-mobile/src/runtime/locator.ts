/**
 * Locator — a lazy, re-evaluating reference to an element in the view tree.
 *
 * Mirrors the Vitest Browser Mode Locator API structure:
 * - query(), element(), elements() are sync (native queries via JSI)
 * - text, exists, props are sync convenience getters
 * - tap(), type() are async (involve timing/side effects)
 */

import { PixelRatio } from 'react-native';
import { waitFor, type RetryOptions } from './retry';
import type { ViewInfo } from './native-harness';
import {
  resolveByTestId,
  resolveByText,
  resolveAllByTestId,
  resolveAllByText,
  readText,
  readProps,
  findHandler,
  Harness,
} from './tree';
import { requestHostTap, requestHostTypeText, isHostBridgeReady } from './host-bridge';
import { g } from './global-types';

export class Locator {
  private _resolve: () => ResolvedElement | null;
  private _description: string;

  constructor(resolve: () => ResolvedElement | null, description: string) {
    this._resolve = resolve;
    this._description = description;
  }

  // ── Browser Mode-aligned query methods (sync) ──

  /** Returns the resolved element or null. Like browser's locator.query(). */
  query(): ResolvedElement | null {
    return this._resolve();
  }

  /** Returns the resolved element. Throws if not found. Like browser's locator.element(). */
  element(): ResolvedElement {
    const el = this._resolve();
    if (!el) {
      throw new Error(`Locator could not find element: ${this._description}`);
    }
    return el;
  }

  /** Returns all matched elements as an array. Like browser's locator.elements(). */
  elements(): ResolvedElement[] {
    const el = this._resolve();
    return el ? [el] : [];
  }

  // ── Convenience getters (mobile-specific) ──

  /** Sync text content of the element. Throws if element not found. */
  get text(): string {
    return readText(this.element());
  }

  /** Sync check if element exists. */
  get exists(): boolean {
    return this._resolve() !== null;
  }

  /** Sync props (frame info) of the element. */
  get props(): Record<string, unknown> {
    return readProps(this.element());
  }

  // ── Actions (async) ──

  /**
   * Resolve the element only once its frame has stabilized across two
   * consecutive queries. Fabric applies mount/unmount transactions
   * asynchronously (VSYNC-gated), so right after a render the view tree can
   * still hold a stale view from the previous test (same testID, different
   * position/size) — resolving on the first hit can return that stale view.
   * Requiring two matching samples waits for the tree to settle.
   */
  private async resolveStable(): Promise<ResolvedElement> {
    let prev: { x: number; y: number; width: number; height: number } | null = null;
    return waitFor(() => {
      const resolved = this._resolve();
      if (!resolved) {
        prev = null;
        throw new Error(`Locator could not find element: ${this._description}`);
      }
      const { x, y, width, height } = resolved.info;
      if (prev !== null && prev.x === x && prev.y === y && prev.width === width && prev.height === height) {
        return resolved;
      }
      prev = { x, y, width, height };
      throw new Error(`Locator view not stable yet: ${this._description}`);
    });
  }

  async tap(): Promise<void> {
    // Drain any pending mount/layout so the query reads the committed tree —
    // otherwise the first query after a render can hit a stale or not-yet-laid-
    // out view at pre-layout coordinates, and the tap misses its target.
    await Harness.flushUIQueue();
    await new Promise<void>(r => g.setImmediate?.(r) ?? setTimeout(r, 0));
    await Harness.flushUIQueue();
    const el = await this.resolveStable();
    const { info } = el;
    if (info && isHostBridgeReady()) {
      // Host-side `adb shell input tap` injects through the full InputManager
      // pipeline (proper touch session), which reliably fires onPress — unlike
      // in-process dispatchTouchEvent, which is flaky on Android headless.
      // info.x/y/width/height are in dp; convert to screen pixels for adb.
      const density = PixelRatio.get();
      const px = Math.round((info.x + info.width / 2) * density);
      const py = Math.round((info.y + info.height / 2) * density);
      await requestHostTap(px, py);
      // Yield to let RN process the touch (onPress → setState → re-render).
      // Deliberately do NOT call flushUIQueue here: the native flushUIQueue
      // drives a synchronous measure()+layout() pass, which disrupts the
      // view's touch state and causes the *next* consecutive tap to be
      // dropped. The assertion's polling handles the re-render commit.
      await new Promise<void>(r => g.setImmediate?.(r) ?? setTimeout(r, 0));
      await new Promise<void>(r => g.setImmediate?.(r) ?? setTimeout(r, 0));
    } else if (info && Harness?.simulatePress) {
      const cx = info.x + info.width / 2;
      const cy = info.y + info.height / 2;
      await Harness.simulatePress(el.nativeId, cx, cy);
      await Harness.flushUIQueue();
      await new Promise<void>(r => g.setImmediate?.(r) ?? setTimeout(r, 0));
      await Harness.flushUIQueue();
    } else {
      const handler = findHandler(el, 'onPress');
      if (!handler) throw new Error(`No onPress handler found on element: ${this._description}`);
      handler();
    }
  }

  async longPress(): Promise<void> {
    const el = await waitFor(() => {
      const resolved = this._resolve();
      if (!resolved) throw new Error(`Locator could not find element: ${this._description}`);
      return resolved;
    });
    const handler = findHandler(el, 'onLongPress');
    if (!handler) throw new Error(`No onLongPress handler found on element: ${this._description}`);
    handler();
  }

  async type(text: string): Promise<void> {
    // Drain pending mount/layout before querying (see tap() for rationale).
    await Harness.flushUIQueue();
    await new Promise<void>(r => g.setImmediate?.(r) ?? setTimeout(r, 0));
    await Harness.flushUIQueue();
    const el = await this.resolveStable();
    const { info } = el;
    if (info && isHostBridgeReady()) {
      // Focus the field with a host tap, then type via the host IME. In-process
      // text mutation gets reverted by RN's controlled-component logic before
      // onChangeText reaches JS; `adb shell input text` is real IME input that
      // RN treats as user typing, so onChangeText fires reliably.
      const density = PixelRatio.get();
      const px = Math.round((info.x + info.width / 2) * density);
      const py = Math.round((info.y + info.height / 2) * density);
      await requestHostTap(px, py);
      await Harness.flushUIQueue();
      await new Promise<void>(r => g.setImmediate?.(r) ?? setTimeout(r, 0));
      await requestHostTypeText(text);
      await Harness.flushUIQueue();
      await new Promise<void>(r => g.setImmediate?.(r) ?? setTimeout(r, 0));
      await Harness.flushUIQueue();
    } else if (el.nativeId && Harness?.typeIntoView) {
      await Harness.typeIntoView(el.nativeId, text);
      // Native insertText: fires onChangeText on the JS thread, but the
      // resulting setState re-render isn't guaranteed to have committed by the
      // time this resolves. Drain the UI queue and yield to JS (mirroring the
      // host-bridge path above) so the controlled value is committed before a
      // subsequent tap() reads a handler closed over the typed text — otherwise
      // e.g. an "add" handler gated on the input still sees the pre-type value.
      await Harness.flushUIQueue();
      await new Promise<void>(r => g.setImmediate?.(r) ?? setTimeout(r, 0));
      await Harness.flushUIQueue();
    } else {
      const handler = findHandler(el, 'onChangeText');
      if (!handler) throw new Error(`No onChangeText handler found on element: ${this._description}`);
      handler(text);
    }
  }

  toString(): string {
    return `Locator(${this._description})`;
  }
}

export type ResolvedElement = { _type: 'native'; nativeId: string; info: ViewInfo; label: string };

export interface LocatorAPI {
  getByTestId(testId: string): Locator;
  getByText(text: string): Locator;
  getAllByTestId(testId: string): Locator[];
  getAllByText(text: string): Locator[];
  queryByTestId(testId: string): Locator | null;
  queryByText(text: string): Locator | null;
  findByTestId(testId: string, options?: RetryOptions): Promise<Locator>;
  findByText(text: string, options?: RetryOptions): Promise<Locator>;
}

export function createLocatorAPI(): LocatorAPI {
  function getByTestId(testId: string): Locator {
    return new Locator(() => resolveByTestId(testId), `testID="${testId}"`);
  }

  function getByText(text: string): Locator {
    return new Locator(() => resolveByText(text), `text="${text}"`);
  }

  function getAllByTestId(testId: string): Locator[] {
    const elements = resolveAllByTestId(testId);
    return elements.map(
      (_, i) =>
        new Locator(() => {
          const all = resolveAllByTestId(testId);
          return all[i] ?? null;
        }, `testID="${testId}"[${i}]`),
    );
  }

  function getAllByText(text: string): Locator[] {
    const elements = resolveAllByText(text);
    return elements.map(
      (_, i) =>
        new Locator(() => {
          const all = resolveAllByText(text);
          return all[i] ?? null;
        }, `text="${text}"[${i}]`),
    );
  }

  function queryByTestId(testId: string): Locator | null {
    const locator = getByTestId(testId);
    return locator.exists ? locator : null;
  }

  function queryByText(text: string): Locator | null {
    const locator = getByText(text);
    return locator.exists ? locator : null;
  }

  async function findByTestId(testId: string, options?: RetryOptions): Promise<Locator> {
    const locator = getByTestId(testId);
    await waitFor(() => {
      if (!locator.exists) {
        throw new Error(`Unable to find element with testID: ${testId}`);
      }
    }, options);
    return locator;
  }

  async function findByText(text: string, options?: RetryOptions): Promise<Locator> {
    const locator = getByText(text);
    await waitFor(() => {
      if (!locator.exists) {
        throw new Error(`Unable to find element with text: ${text}`);
      }
    }, options);
    return locator;
  }

  return {
    getByTestId,
    getByText,
    getAllByTestId,
    getAllByText,
    queryByTestId,
    queryByText,
    findByTestId,
    findByText,
  };
}
