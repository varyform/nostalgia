import { describe, expect, it } from 'vite-plus/test';
import { createAutosave, keyOf, savedAgo } from './index.ts';

function memory() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe('createAutosave', () => {
  it('saves, loads and clears one checkpoint per game', () => {
    const storage = memory();
    const a = createAutosave<{ level: number }>('quarry', { storage, now: () => 1000 });
    expect(a.load()).toBeNull();
    a.save({ level: 4 }, 'Level 5');
    expect(a.load()).toEqual({ state: { level: 4 }, label: 'Level 5', at: 1000 });
    a.save({ level: 5 }, 'Level 6');
    expect(a.load()?.state.level).toBe(5);
    expect([...storage.m.keys()]).toEqual([keyOf('quarry')]);
    a.clear();
    expect(a.load()).toBeNull();
  });

  it('does nothing at all when disabled (demo mode)', () => {
    const storage = memory();
    createAutosave('quarry', { storage }).save({ level: 1 }, 'Level 2');
    const demo = createAutosave('quarry', { storage, enabled: false });
    expect(demo.load()).toBeNull();
    demo.save({ level: 9 }, 'x');
    demo.clear();
    expect(JSON.parse(storage.m.get(keyOf('quarry'))!).state).toEqual({ level: 1 });
  });

  it('ignores a save from another version, and junk', () => {
    const storage = memory();
    createAutosave('g', { storage, version: 1 }).save({ a: 1 }, 'old');
    expect(createAutosave('g', { storage, version: 2 }).load()).toBeNull();
    storage.m.set(keyOf('g'), '{not json');
    expect(createAutosave('g', { storage }).load()).toBeNull();
  });

  it('survives storage that throws', () => {
    const boom = () => {
      throw new Error('blocked');
    };
    const a = createAutosave('g', { storage: { getItem: boom, setItem: boom, removeItem: boom } });
    expect(() => a.save({}, 'x')).not.toThrow();
    expect(a.load()).toBeNull();
    expect(() => a.clear()).not.toThrow();
  });
});

describe('savedAgo', () => {
  const now = 10 * 86_400_000;
  it('reads like a person would say it', () => {
    expect(savedAgo(now - 10_000, now)).toBe('just now');
    expect(savedAgo(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(savedAgo(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(savedAgo(now - 86_400_000, now)).toBe('1 day ago');
    expect(savedAgo(now - 4 * 86_400_000, now)).toBe('4 days ago');
  });
});
