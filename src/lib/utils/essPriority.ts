// src/lib/utils/essPriority.ts
// Koordinator prioritas jaringan untuk rute absensi (/ess & /ess/absen).
// Mencegah puluhan komponen global layout menembak Directus bersamaan dengan
// GET /api/ess/attendance/status saat jam sibuk pagi/sore.
//
// Pada rute selain /ess & /ess/absen, waitForAttendancePriority() langsung resolve
// tanpa timer (nol dampak ke halaman lain).

export function isAttendancePriorityRoute(pathname: string): boolean {
	if (!pathname) return false;
	return (
		pathname === '/ess' ||
		pathname === '/ess/' ||
		pathname === '/ess/absen' ||
		pathname.startsWith('/ess/absen/')
	);
}

let active = false;
let ready = false;
const waiters = new Set<() => void>();

function flushWaiters(): void {
	if (waiters.size === 0) return;
	const callbacks = [...waiters];
	waiters.clear();
	for (const fn of callbacks) {
		try {
			fn();
		} catch {
			/* abaikan galat listener */
		}
	}
}

/** Tandai fase prioritas absensi dimulai (dipanggil saat /ess mulai memeriksa status absensi). */
export function beginAttendancePriority(): void {
	active = true;
	ready = false;
}

/** Tandai status absensi sudah selesai dimuat (sukses/gagal/unmount) → lepaskan fetch non-kritis. */
export function markAttendanceReady(): void {
	active = false;
	ready = true;
	flushWaiters();
}

/** True bila saat ini berada di jendela prioritas absensi (belum selesai memuat status). */
export function isAttendancePriorityPending(): boolean {
	if (ready) return false;
	if (active) return true;
	if (typeof window !== 'undefined' && isAttendancePriorityRoute(window.location.pathname)) {
		return true;
	}
	return false;
}

/**
 * Tunggu sampai pemeriksaan status absensi selesai (atau batas `timeoutMs` tercapai).
 * Langsung resolve tanpa timer jika bukan rute absensi atau sudah selesai.
 */
export function waitForAttendancePriority(timeoutMs = 4_000): Promise<void> {
	if (!isAttendancePriorityPending()) {
		return Promise.resolve();
	}
	return new Promise<void>((resolve) => {
		let done = false;
		const finish = () => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			waiters.delete(finish);
			resolve();
		};
		const timer = setTimeout(finish, Math.max(0, timeoutMs));
		waiters.add(finish);
	});
}

/** Khusus unit test: reset state koordinator prioritas. */
export function _resetAttendancePriorityForTest(): void {
	active = false;
	ready = false;
	waiters.clear();
}

