// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	/** Toast global: dipasang oleh components/Toast.svelte (belum ada sebelum komponen termuat → selalu pakai `?.`). */
	interface Window {
		__showToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
	}

	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
