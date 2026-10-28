import directus, { handleDirectusError } from './directus';
import { readItems, readItem, createItem, updateItem, deleteItem, uploadFiles } from '@directus/sdk';
import imageCompression from 'browser-image-compression';

export interface SupportTicketRow {
	id: string;
	nomor_tiket: string;
	tanggal: string;
	jenis: string;
	tipe: string;
	judul: string;
	deskripsi: string;
	prioritas: string;
	departemen_tujuan: string | null;
	departemen_pelapor: string | null;
	pelapor_nama: string | null;
	status: string;
	pic: string | null;
	solusi: string | null;
	sumber: string;
	verifikasi_status: string;
	verified_by: string | null;
	verified_at: string | null;
	catatan_verifikasi: string | null;
	pelapor_id: string | null;
	lokasi: string | null;
	project_id: string | null;
	lampiran: string | null;
	kategori?: string | null;
	complaint_id?: number | null;
	date_created: string;
}

export interface SupportTicketLog {
	id: string;
	tiket_id: string;
	tipe: string;
	catatan: string | null;
	status_dari: string | null;
	status_ke: string | null;
	pic_dari: string | null;
	pic_ke: string | null;
	departemen_dari: string | null;
	departemen_ke: string | null;
	oleh: string | null;
	date_created: string;
	lampiran: string | null;
	is_completed?: boolean;
}

export async function toggleTicketLogCompletion(logId: string, isCompleted: boolean): Promise<SupportTicketLog> {
	try {
		return (await directus.request(
			updateItem('support_tiket_log', logId, {
				is_completed: isCompleted
			})
		)) as SupportTicketLog;
	} catch (error) {
		handleDirectusError(error);
		throw error;
	}
}

export async function updateTicketLog(logId: string, patch: Partial<SupportTicketLog>): Promise<SupportTicketLog> {
	try {
		return (await directus.request(
			updateItem('support_tiket_log', logId, patch)
		)) as SupportTicketLog;
	} catch (error) {
		handleDirectusError(error);
		throw error;
	}
}

export async function deleteTicketLog(logId: string): Promise<void> {
	try {
		await directus.request(deleteItem('support_tiket_log', logId));
	} catch (error) {
		handleDirectusError(error);
		throw error;
	}
}

export async function getTicketLogs(ticketId: string): Promise<SupportTicketLog[]> {
	try {
		return (await directus.request(
			readItems('support_tiket_log', {
				filter: { tiket_id: { _eq: ticketId } },
				fields: [
					'id', 'tiket_id', 'tipe', 'catatan', 'status_dari', 'status_ke',
					'pic_dari', 'pic_ke', 'departemen_dari', 'departemen_ke', 'oleh', 'date_created', 'lampiran', 'is_completed'
				],
				sort: ['-date_created'],
				limit: -1
			})
		)) as SupportTicketLog[];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}


export interface FieldTicketPayload {
	tipe: string;
	judul: string;
	deskripsi: string;
	prioritas: string;
	departemen_tujuan: string;
	project_id?: string | null;
	lokasi?: string | null;
	lampiran?: string | null;
	pelapor_id: string;
	pelapor_nama: string;
	departemen_pelapor?: string | null;
	pic?: string | null;
}

const COLLECTION = 'support_tiket';

export const TIPE_OPTIONS = ['Komplain', 'Permintaan', 'Pertanyaan'];
export const PRIORITAS_OPTIONS = ['Rendah', 'Sedang', 'Tinggi', 'Urgent'];
export const DEPARTEMEN_OPTIONS = [
	'Sales', 'Produksi', 'IT', 'Finance', 'QC', 'Logistik', 'Procurement', 'Project', 'Ciketing', 'HRD', 'Maintenance', 'GA', 'Lainnya'
];

const TICKET_FIELDS = [
	'id', 'nomor_tiket', 'tanggal', 'jenis', 'tipe', 'judul', 'deskripsi', 'prioritas',
	'departemen_tujuan', 'departemen_pelapor', 'pelapor_nama', 'status', 'pic', 'solusi',
	'sumber', 'verifikasi_status', 'verified_by', 'verified_at', 'catatan_verifikasi',
	'pelapor_id', 'lokasi', 'project_id', 'lampiran', 'complaint_id', 'date_created'
];

/**
 * Format CS-YYYY-NNNN — mirror dari getNextTicketNumber() di erp-epi-1/supportTicketApi.js
 * agar penomoran tunggal lintas lapangan & admin (satu koleksi Directus bersama).
 */
export async function getNextTicketNumber(): Promise<string> {
	const year = new Date().getFullYear();
	const prefix = `CS-${year}-`;
	try {
		const result: any = await directus.request(
			readItems(COLLECTION, {
				filter: { nomor_tiket: { _starts_with: prefix } },
				fields: ['nomor_tiket'],
				sort: ['-nomor_tiket'],
				limit: 1
			})
		);
		const last = result?.[0]?.nomor_tiket || '';
		const lastSeq = parseInt(last.slice(prefix.length), 10);
		const next = Number.isFinite(lastSeq) ? lastSeq + 1 : 1;
		return `${prefix}${String(next).padStart(4, '0')}`;
	} catch (error) {
		console.warn('Gagal generate nomor tiket, fallback timestamp:', error);
		return `${prefix}${String(Date.now()).slice(-4)}`;
	}
}

// ===========================================================================
// Support Bridge — Komplain customer lapangan -> tiket Support Center
// (Komplain↔Tiket, 31 Agu 2026). Sebelumnya komplain customer masuk sebagai
// support_tiket; setelah dipindah ke koleksi kanonik 8D `customer_complaints`
// (project-epi /komplain-customer), tautan ke Support Center hilang sehingga
// komplain "tidak masuk" ke /support. Bridge ini mengembalikannya: satu tiket
// otomatis per komplain, tertaut dua arah lewat complaint_id / support_tiket_id.
// ===========================================================================

const KOMPLAIN_ROUTING_DEFAULT: Record<string, string> = {
	kualitas: 'QC', aplikasi: 'QC', pengiriman: 'Logistik', harga: 'Sales', layanan: 'Sales', lainnya: 'QC'
};
const KOMPLAIN_KATEGORI_LABEL: Record<string, string> = {
	kualitas: 'Kualitas Produk', pengiriman: 'Pengiriman & Logistik', layanan: 'Layanan & Komunikasi',
	harga: 'Harga & Komersial', aplikasi: 'Aplikasi Lapangan', lainnya: 'Lainnya'
};
// Prioritas komplain lapangan (normal/urgent/critical) -> prioritas tiket support.
const KOMPLAIN_PRIORITAS_MAP: Record<string, string> = { normal: 'Sedang', urgent: 'Tinggi', critical: 'Urgent' };

export interface ComplaintBridgeInput {
	complaintId: number;
	kategori: string;
	deskripsi: string;
	customerId?: number | null;
	customerName?: string | null;
	kontak?: string | null;
	site?: string | null;
	prioritas?: string | null;
	pelaporNama?: string | null;
	fotoFileId?: string | null;
}

/**
 * Auto-bridge komplain -> support_tiket. Best-effort: kegagalan di sini TIDAK
 * boleh membatalkan komplain (dipanggil setelah komplain tersimpan). Idempoten
 * via complaint_id sehingga retry antrian offline tidak menggandakan tiket.
 * Mengembalikan id tiket (number) atau null bila dimatikan / gagal.
 */
export async function bridgeComplaintToSupport(input: ComplaintBridgeInput): Promise<number | null> {
	try {
		// 1. Setelan bersama admin (system_settings namespace support.komplain_*).
		let enabled = true;
		let autoVerif = false;
		let routing: Record<string, string> = { ...KOMPLAIN_ROUTING_DEFAULT };
		try {
			const rows: any[] = await directus.request(
				readItems('system_settings' as any, {
					filter: { setting_key: { _in: [
						'support.komplain_bridge_enabled', 'support.komplain_auto_verifikasi', 'support.komplain_routing'
					] } } as any,
					fields: ['setting_key', 'setting_value'],
					limit: 3
				})
			);
			for (const r of rows) {
				let v: any;
				try { v = JSON.parse(r.setting_value); } catch { continue; }
				if (r.setting_key === 'support.komplain_bridge_enabled') enabled = Boolean(v);
				else if (r.setting_key === 'support.komplain_auto_verifikasi') autoVerif = Boolean(v);
				else if (r.setting_key === 'support.komplain_routing' && v && typeof v === 'object') routing = { ...routing, ...v };
			}
		} catch (e) {
			console.warn('[bridgeComplaintToSupport] gagal baca system_settings, pakai default:', e);
		}
		if (!enabled) return null;

		// 2. Idempotensi — sudah pernah dibuatkan tiket untuk komplain ini?
		try {
			const existing: any[] = await directus.request(
				readItems(COLLECTION, { filter: { complaint_id: { _eq: input.complaintId } } as any, fields: ['id'], limit: 1 })
			);
			if (existing?.length) return Number(existing[0].id);
		} catch { /* lanjut buat baru */ }

		// 3. Lengkapi nama customer bila hanya id yang tersedia (jalur antrian offline).
		let customerName = input.customerName || null;
		if (!customerName && input.customerId) {
			try {
				const c: any[] = await directus.request(
					readItems('master_customer' as any, { filter: { id: { _eq: input.customerId } } as any, fields: ['nama_sj_fp'], limit: 1 })
				);
				customerName = c?.[0]?.nama_sj_fp || null;
			} catch { /* biarkan null */ }
		}

		const dept = routing[input.kategori] || routing.lainnya || 'QC';
		const prioritas = KOMPLAIN_PRIORITAS_MAP[String(input.prioritas || 'normal')] || 'Sedang';
		const kategoriLabel = KOMPLAIN_KATEGORI_LABEL[input.kategori] || input.kategori || 'Umum';
		const judul = `Komplain ${kategoriLabel} — ${customerName || 'Customer Lapangan'}`.slice(0, 255);
		const deskripsi = [
			(input.deskripsi || '-').trim(),
			'',
			'---',
			`[Auto-bridge dari Komplain Lapangan #${input.complaintId}]`,
			`Investigasi 8D (RCA, retained sample, eskalasi R&D): modul R&D › Komplain — /rnd/komplain?id=${input.complaintId}`,
			input.kontak ? `Kontak pelapor / PIC customer: ${input.kontak}` : null,
			input.site ? `Site / plant: ${input.site}` : null
		].filter((l) => l !== null).join('\n');

		// 4. Buat tiket (retry bila nomor_tiket tabrakan — digenerate baca-lalu-tulis).
		const MAX_ATTEMPTS = 3;
		let lastErr: any;
		for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
			const nomor_tiket = await getNextTicketNumber();
			try {
				const created: any = await directus.request(
					createItem(COLLECTION, {
						nomor_tiket,
						tanggal: new Date().toISOString(),
						jenis: 'External',
						tipe: 'Komplain',
						judul,
						deskripsi,
						kategori: input.kategori || null,
						customer_name: customerName,
						kontak: input.kontak || null,
						prioritas,
						departemen_tujuan: dept,
						pelapor_nama: input.pelaporNama || null,
						input_by: input.pelaporNama || null,
						sumber: 'Lapangan',
						status: 'Open',
						verifikasi_status: autoVerif ? 'Terverifikasi' : 'Menunggu Verifikasi',
						lokasi: input.site || null,
						lampiran: input.fotoFileId ? JSON.stringify([input.fotoFileId]) : null,
						complaint_id: input.complaintId
					})
				);
				return Number(created.id);
			} catch (error: any) {
				lastErr = error;
				const msg = error?.errors?.[0]?.message || error?.message || '';
				if (!/unique|sudah ada|duplicate/i.test(msg) || attempt === MAX_ATTEMPTS) break;
			}
		}
		console.warn('[bridgeComplaintToSupport] gagal membuat tiket support:', lastErr);
		return null;
	} catch (e) {
		console.warn('[bridgeComplaintToSupport] error tak terduga (diabaikan):', e);
		return null;
	}
}

export async function getMyTickets(pelaporId: string, page = 1, limit = 20): Promise<SupportTicketRow[]> {
	try {
		return (await directus.request(
			readItems(COLLECTION, {
				filter: { pelapor_id: { _eq: pelaporId } },
				fields: TICKET_FIELDS,
				sort: ['-date_created'],
				page,
				limit
			})
		)) as SupportTicketRow[];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export async function getAllTickets(page = 1, limit = 20): Promise<SupportTicketRow[]> {
	try {
		return (await directus.request(
			readItems(COLLECTION, {
				fields: TICKET_FIELDS,
				sort: ['-date_created'],
				page,
				limit
			})
		)) as SupportTicketRow[];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}


export async function getTicketById(id: string): Promise<SupportTicketRow | null> {
	try {
		return (await directus.request(readItem(COLLECTION, id, { fields: TICKET_FIELDS }))) as SupportTicketRow;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

/**
 * Kompres foto di sisi klien sebelum unggah — foto dari HP lapangan sering
 * berukuran beberapa MB, memperlambat upload di jaringan lokasi yang lemah.
 */
async function compressPhoto(file: File): Promise<File> {
	try {
		return await imageCompression(file, {
			maxSizeMB: 1,
			maxWidthOrHeight: 1600,
			useWebWorker: true
		});
	} catch (error) {
		console.warn('Gagal kompres foto, unggah ukuran asli:', error);
		return file;
	}
}

export async function uploadTicketPhoto(file: File): Promise<string | null> {
	try {
		const compressed = file.type.startsWith('image/') ? await compressPhoto(file) : file;
		const formData = new FormData();
		formData.append('file', compressed, file.name);
		formData.append('description', 'support_tiket:lampiran');
		const result: any = await directus.request(uploadFiles(formData));
		return result?.id || null;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

export async function uploadMultipleTicketPhotos(files: File[]): Promise<string[]> {
	if (!files || files.length === 0) return [];
	const ids: string[] = [];
	for (const file of files) {
		const id = await uploadTicketPhoto(file);
		if (id) ids.push(id);
	}
	return ids;
}

export function parseLampiranIds(lampiran: string | null | undefined): string[] {
	if (!lampiran) return [];
	if (typeof lampiran !== 'string') return [];
	const trimmed = lampiran.trim();
	if (!trimmed) return [];
	if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
		try {
			const parsed = JSON.parse(trimmed);
			if (Array.isArray(parsed)) return parsed.map(s => String(s).trim()).filter(Boolean);
		} catch (e) {
			// ignore fallback
		}
	}
	return trimmed.split(',').map(s => s.trim()).filter(Boolean);
}


/**
 * Tiket dari lapangan selalu masuk sebagai jenis Internal, sumber Lapangan,
 * dan menunggu gerbang verifikasi admin/SPV — sesuai alur di
 * Rencana-Integrasi-Support-Center-EndToEnd.pdf.
 */
export async function createFieldTicket(payload: FieldTicketPayload): Promise<SupportTicketRow> {
	// Fase 0 (B-04): nomor_tiket digenerate baca-lalu-tulis tanpa kunci di dua
	// dashboard sekaligus — dua submit bersamaan bisa tabrakan pada unique
	// constraint nomor_tiket. Retry dengan nomor baru alih-alih gagal total.
	const MAX_ATTEMPTS = 3;
	let lastError: any;
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		const nomor_tiket = await getNextTicketNumber();
		try {
			const created: any = await directus.request(
				createItem(COLLECTION, {
					nomor_tiket,
					tanggal: new Date().toISOString(),
					jenis: 'Internal',
					tipe: payload.tipe,
					judul: payload.judul,
					deskripsi: payload.deskripsi,
					prioritas: payload.prioritas,
					departemen_tujuan: payload.departemen_tujuan,
					departemen_pelapor: payload.departemen_pelapor || null,
					pelapor_nama: payload.pelapor_nama,
					input_by: payload.pelapor_nama,
					sumber: 'Lapangan',
					verifikasi_status: 'Menunggu Verifikasi',
					pelapor_id: payload.pelapor_id,
					project_id: payload.project_id || null,
					lokasi: payload.lokasi || null,
					lampiran: payload.lampiran || null,
					pic: payload.pic || null
				})
			);

			await logSupportActivity({
				actorName: payload.pelapor_nama,
				action: 'create',
				recordId: created.id,
				description: `Membuat tiket lapangan ${nomor_tiket} — ${payload.judul}`
			});

			return created as SupportTicketRow;
		} catch (error: any) {
			lastError = error;
			const msg = error?.errors?.[0]?.message || error?.message || '';
			const isDup = /unique|sudah ada|duplicate/i.test(msg);
			if (!isDup || attempt === MAX_ATTEMPTS) break;
			console.warn(`Nomor tiket tabrakan, retry ${attempt}/${MAX_ATTEMPTS}...`);
		}
	}
	handleDirectusError(lastError);
	throw lastError;
}

/**
 * Ajukan ulang tiket yang ditolak admin: kembalikan ke antrean verifikasi
 * dan bersihkan catatan penolakan sebelumnya.
 */
export async function resubmitTicket(
	id: string,
	payload: Partial<FieldTicketPayload>,
	actorName: string
): Promise<SupportTicketRow> {
	const updated: any = await directus.request(
		updateItem(COLLECTION, id, {
			...payload,
			verifikasi_status: 'Menunggu Verifikasi',
			catatan_verifikasi: null
		})
	);

	await logSupportActivity({
		actorName,
		action: 'update',
		recordId: id,
		description: `Mengajukan ulang tiket ${updated.nomor_tiket}`
	});

	return updated as SupportTicketRow;
}

/**
 * Update data isi tiket support dari modal/detail.
 */
export async function updateSupportTicket(
	id: string,
	patch: Partial<SupportTicketRow>,
	actorName: string = 'User'
): Promise<SupportTicketRow> {
	const updated: any = await directus.request(
		updateItem(COLLECTION, id, patch)
	);

	await logSupportActivity({
		actorName,
		action: 'update',
		recordId: id,
		description: `Memperbarui isi tiket ${updated.nomor_tiket || id}`
	});

	// Fase 3: bila status tiket komplain jadi Resolved/Closed dari lapangan, tutup
	// komplain 8D terkait juga. Kembar dari erp-epi-1 supportComplaintSync.js.
	if (patch.status && ['Resolved', 'Closed'].includes(String(patch.status)) && updated?.complaint_id) {
		await syncTicketResolutionToComplaint(updated);
	}

	return updated as SupportTicketRow;
}

/**
 * Tiket komplain di-Resolved/Closed -> tutup komplain 8D (customer_complaints)
 * terkait bila belum. Best-effort, anti-loop (cek status tujuan dulu, tulis
 * langsung tanpa lewat advanceStage/updateComplaint admin).
 */
async function syncTicketResolutionToComplaint(ticket: any): Promise<void> {
	try {
		const complaintId = ticket?.complaint_id;
		if (!complaintId) return;
		const cur: any = await directus.request(
			readItem('customer_complaints', complaintId, { fields: ['id', 'status', 'resolusi'] })
		);
		if (!cur || cur.status === 'tutup') return;

		const now = new Date().toISOString();
		const patch: Record<string, any> = {
			status: 'tutup',
			status_changed_at: now,
			resolved_date: now.slice(0, 10),
			sla_due_at: null
		};
		if (!cur.resolusi && ticket.solusi) patch.resolusi = ticket.solusi;

		await directus.request(updateItem('customer_complaints', complaintId, patch));
		await logSupportActivity({
			actorName: 'Sistem (sinkron)',
			action: 'status',
			recordId: complaintId,
			description: `SUPPORT_SYNC: komplain #${complaintId} ditutup (D8) karena tiket ${ticket.nomor_tiket || ticket.id} ${ticket.status}.`
		});
	} catch (e) {
		console.warn('[support] gagal sinkron tiket->komplain (diabaikan):', e);
	}
}

/**
 * Log ke koleksi activity_log yang sama dipakai dashboard admin (logCrud di
 * erp-epi-1/activityLogApi.js), supaya aksi dari lapangan juga terlihat
 * di Activity Log admin. Non-fatal — kegagalan log tidak menggagalkan transaksi inti.
 */
async function logSupportActivity(entry: {
	actorName: string;
	action: string;
	recordId: string | number;
	description: string;
}) {
	try {
		await directus.request(
			createItem('activity_log', {
				module: 'support',
				collection: COLLECTION,
				record_id: String(entry.recordId),
				action: entry.action,
				activity_type: entry.action,
				description: entry.description,
				actor_id: entry.actorName,
				actor_name: entry.actorName,
				actor_role: 'Lapangan',
				created_at: new Date().toISOString()
			})
		);
	} catch (error) {
		console.warn('Gagal mencatat activity log:', error);
	}
}

