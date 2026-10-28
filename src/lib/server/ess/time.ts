// src/lib/server/ess/time.ts
// Waktu lokal Asia/Jakarta (WIB, UTC+7) dihitung di server — bukan jam device klien,
// supaya tanggal/jam absensi tidak bisa dipalsukan dengan mengubah jam HP.

function jakartaParts(date: Date) {
	const fmt = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Asia/Jakarta',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	});
	const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
	return parts as Record<'year' | 'month' | 'day' | 'hour' | 'minute', string>;
}

/** Tanggal hari ini di WIB, format YYYY-MM-DD (cocok dengan field `tanggal` Directus). */
export function todayJakarta(date = new Date()): string {
	const p = jakartaParts(date);
	return `${p.year}-${p.month}-${p.day}`;
}

/** Jam saat ini di WIB, format HH:mm (cocok dengan field `jam_masuk`/`jam_keluar`). */
export function nowTimeJakarta(date = new Date()): string {
	const p = jakartaParts(date);
	return `${p.hour}:${p.minute}`;
}
