// Disable SSR for the entire app.
// Firebase Auth and @tabler/icons-svelte require browser APIs (window, document)
// that are not available during server-side rendering.
export const ssr = false;
