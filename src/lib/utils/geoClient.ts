// src/lib/utils/geoClient.ts
// Ambil posisi GPS perangkat (browser-only). Perhitungan jarak/validasi geofence
// dilakukan di server (src/lib/server/ess/geo.ts) — di sini hanya membaca posisi mentah.

export interface DevicePosition {
	lat: number;
	lng: number;
	accuracy: number;
}

export function getCurrentPosition(options: PositionOptions = {}): Promise<DevicePosition> {
	return new Promise((resolve, reject) => {
		if (typeof navigator === 'undefined' || !navigator.geolocation) {
			reject(new Error('Perangkat tidak mendukung layanan lokasi'));
			return;
		}
		navigator.geolocation.getCurrentPosition(
			(pos) =>
				resolve({
					lat: pos.coords.latitude,
					lng: pos.coords.longitude,
					accuracy: pos.coords.accuracy
				}),
			(err) => reject(new Error(err.message || 'Gagal mengambil lokasi (izin ditolak?)')),
			{ enableHighAccuracy: true, timeout: 10000, maximumAge: 0, ...options }
		);
	});
}

/**
 * UX-02 (correction plan site-visit-payroll): GPS otomatis saat form dibuka, bukan menunggu
 * leader menekan tombol. Terus memperbarui posisi (watchPosition) sampai akurasi mencapai
 * targetAccuracyM ATAU timeoutMs terlewati — mana pun lebih dulu — supaya leader tidak menunggu
 * lama di lokasi bersinyal lemah (fix akurasi tinggi sering >10 dtk di dalam gedung/pabrik).
 * onPosition dipanggil tiap ada pembacaan baru (biasanya makin akurat), bukan cuma sekali.
 * Kembalikan fungsi stop() untuk membatalkan watch lebih awal (mis. saat komponen unmount).
 */
export function watchPositionUntilAccurate(
	onPosition: (pos: DevicePosition) => void,
	onError: (err: Error) => void,
	options: { targetAccuracyM?: number; timeoutMs?: number } = {}
): () => void {
	const targetAccuracyM = options.targetAccuracyM ?? 50;
	const timeoutMs = options.timeoutMs ?? 20000;

	if (typeof navigator === 'undefined' || !navigator.geolocation) {
		onError(new Error('Perangkat tidak mendukung layanan lokasi'));
		return () => {};
	}

	let stopped = false;
	const watchId = navigator.geolocation.watchPosition(
		(pos) => {
			if (stopped) return;
			const devicePos: DevicePosition = {
				lat: pos.coords.latitude,
				lng: pos.coords.longitude,
				accuracy: pos.coords.accuracy
			};
			onPosition(devicePos);
			if (devicePos.accuracy <= targetAccuracyM) stop();
		},
		(err) => {
			if (!stopped) onError(new Error(err.message || 'Gagal mengambil lokasi (izin ditolak?)'));
		},
		{ enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs }
	);

	const timeoutId = setTimeout(stop, timeoutMs);

	function stop() {
		if (stopped) return;
		stopped = true;
		clearTimeout(timeoutId);
		navigator.geolocation.clearWatch(watchId);
	}

	return stop;
}
