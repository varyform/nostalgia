/**
 * @nostalgia/save — a game's autosave: one checkpoint per game, resumed from the title's CONTINUE.
 *
 *   import { createAutosave } from '@nostalgia/save';
 *
 *   const autosave = createAutosave('quarry', { enabled: !demo, version: 1 });
 *
 *   // a checkpoint: where a level, tower or round begins, with everything needed to start it again
 *   autosave.save({ level: 4, score: 12340, lives: 2 }, 'Level 5 · 12,340');
 *
 *   const saved = autosave.load();   // { state, label, at } or null
 *   if (saved) menu.unshift({ label: `CONTINUE  ${saved.label}`, … });   // savedAgo(saved.at): "5 min ago"
 *
 *   autosave.clear();                // on game over, and when the game is beaten
 *
 * Checkpoints, not snapshots: a game saves what it needs to begin the current stage again (the
 * stage, score, lives, inventory…), never a frozen sim mid-level. Continuing restarts that stage
 * as it began. Demo mode passes `enabled: false`, so it never reads, writes or clears a save.
 *
 * A save from another `version` of the game's state is ignored (and replaced at the next
 * checkpoint): bump `version` whenever the shape of `state` changes. Storage that is blocked,
 * full or holding something unreadable behaves as if there were no save.
 */

export interface Saved<T> {
  /** What the game handed to save(). */
  state: T;
  /** One short line for the title, e.g. "Tower 3 · 12,400". */
  label: string;
  /** When it was saved, in ms since the epoch. */
  at: number;
}

export interface Autosave<T> {
  /** The checkpoint, or null: none yet, disabled, unreadable, or from another version. */
  load(): Saved<T> | null;
  /** Remember a checkpoint, replacing the last one. */
  save(state: T, label: string): void;
  /** Forget it: the title stops offering CONTINUE. */
  clear(): void;
}

export interface AutosaveOptions {
  /** false (demo mode) makes every call a no-op and load() return null. */
  enabled?: boolean;
  /** The shape of `state`; a save written under another version is ignored. */
  version?: number;
  /** Where it lives; localStorage by default (injectable for tests). */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  /** The clock; Date.now by default. */
  now?: () => number;
}

/** The localStorage key a game's autosave lives under. */
export const keyOf = (game: string): string => `nostalgia:autosave:${game}`;

export function createAutosave<T>(
  game: string,
  { enabled = true, version = 1, storage, now = Date.now }: AutosaveOptions = {},
): Autosave<T> {
  const key = keyOf(game);
  const store = (): AutosaveOptions['storage'] | null => {
    try {
      return storage ?? globalThis.localStorage ?? null;
    } catch {
      return null; // reading localStorage itself can throw where it is blocked
    }
  };
  return {
    load() {
      if (!enabled) return null;
      try {
        const raw = store()?.getItem(key);
        if (!raw) return null;
        const v = JSON.parse(raw) as { v?: unknown; state?: T; label?: unknown; at?: unknown };
        if (v.v !== version || v.state === undefined) return null;
        return {
          state: v.state,
          label: typeof v.label === 'string' ? v.label : '',
          at: typeof v.at === 'number' ? v.at : 0,
        };
      } catch {
        return null;
      }
    },
    save(state, label) {
      if (!enabled) return;
      try {
        store()?.setItem(key, JSON.stringify({ v: version, state, label, at: now() }));
      } catch {
        /* blocked or full: the game goes on without a checkpoint */
      }
    },
    clear() {
      if (!enabled) return;
      try {
        store()?.removeItem(key);
      } catch {
        /* blocked */
      }
    },
  };
}

/** "just now", "5 min ago", "3 h ago", "2 days ago": how old a save is, for the title. */
export function savedAgo(at: number, now: number = Date.now()): string {
  const min = Math.floor((now - at) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? '1 day ago' : `${d} days ago`;
}
