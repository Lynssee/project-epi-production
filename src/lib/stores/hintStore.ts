import { writable } from 'svelte/store';
import { browser } from '$app/environment';

const PREFIX_OPEN = 'hint_open_';
const PREFIX_DISMISSED = 'hint_dismissed_';
const VERSION_KEY = 'hint_version';

/**
 * Versi konten hint.
 * Harus dijaga sinkron dengan HINTS_VERSION di erp-epi-1 (Dashboard Admin).
 */
export const HINTS_VERSION = '2026-09-01';

/** Menghapus seluruh kunci hint tanpa menyentuh kunci versi. */
function clearAllHintKeys(): void {
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(PREFIX_OPEN) || key?.startsWith(PREFIX_DISMISSED)) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach(key => localStorage.removeItem(key));
}

/**
 * Menyelaraskan versi tersimpan dengan HINTS_VERSION; bila berbeda, semua cache hint lama dibuang.
 * @returns true bila state hint baru saja direset.
 */
function syncVersion(): boolean {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(VERSION_KEY);
  } catch {
    return false; // localStorage diblokir — perlakukan sebagai "tak ada preference".
  }
  if (stored === HINTS_VERSION) return false;
  clearAllHintKeys();
  try {
    localStorage.setItem(VERSION_KEY, HINTS_VERSION);
  } catch {
    // Abaikan: gagal menulis versi hanya berarti sinkronisasi diulang di sesi berikutnya.
  }
  return true;
}

function createHintStore() {
  const { subscribe, set, update } = writable<Record<string, boolean>>({});

  // Initialize from localStorage — setelah memastikan versi hint masih berlaku.
  if (browser) {
    const wasReset = syncVersion();
    const initialState: Record<string, boolean> = {};
    if (!wasReset) {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(PREFIX_OPEN)) {
          const id = key.substring(PREFIX_OPEN.length);
          initialState[id] = localStorage.getItem(key) === 'true';
        }
      }
    }
    set(initialState);
  }

  return {
    subscribe,
    openHint: (id: string) => {
      if (browser) {
        localStorage.setItem(`${PREFIX_OPEN}${id}`, 'true');
        localStorage.removeItem(`${PREFIX_DISMISSED}${id}`);
      }
      update(state => ({ ...state, [id]: true }));
    },
    closeHint: (id: string) => {
      if (browser) {
        localStorage.removeItem(`${PREFIX_OPEN}${id}`);
      }
      update(state => {
        const newState = { ...state };
        delete newState[id];
        return newState;
      });
    },
    isHintOpen: (id: string, defaultVal = false): boolean => {
      if (browser && id) {
        syncVersion();
        const stored = localStorage.getItem(`${PREFIX_OPEN}${id}`);
        if (stored !== null) {
          return stored === 'true';
        }
        return defaultVal;
      }
      return defaultVal;
    },
    dismissHint: (id: string) => {
      if (browser) {
        localStorage.removeItem(`${PREFIX_OPEN}${id}`);
      }
      update(state => {
        const newState = { ...state };
        delete newState[id];
        return newState;
      });
    },
    resetHint: (id: string) => {
      if (browser) {
        localStorage.setItem(`${PREFIX_OPEN}${id}`, 'true');
      }
      update(state => ({ ...state, [id]: true }));
    },
    resetAllHints: () => {
      if (browser) {
        clearAllHintKeys();
      }
      set({});
    },
    isHintDismissed: (id: string) => {
      if (browser && id) {
        return localStorage.getItem(`${PREFIX_OPEN}${id}`) !== 'true';
      }
      return true;
    }
  };
}

export const hintStore = createHintStore();

