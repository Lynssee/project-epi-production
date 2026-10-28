// Consent lokasi untuk Driver App (UU PDP) — ditampilkan sekali saat pertama pakai,
// lalu tersimpan di localStorage. Checkpoint manual sudah meminimalkan data lokasi
// yang terkumpul (lihat Bagian 5.3 dokumen rencana implementasi).

const STORAGE_KEY = 'epi_driver_location_consent';

export function hasLocationConsent(): boolean {
	if (typeof localStorage === 'undefined') return false;
	return localStorage.getItem(STORAGE_KEY) === 'granted';
}

export function grantLocationConsent() {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(STORAGE_KEY, 'granted');
}
