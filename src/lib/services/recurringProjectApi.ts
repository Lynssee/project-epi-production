import directus, { handleDirectusError } from './directus';
import { readItems, createItem } from '@directus/sdk';

export interface ProjectRecurringItem {
	id: number;
	nama_pengeluaran: string;
	stream_type?: string;
	kategori?: string;
	vendor_penerima?: string;
	nominal: number;
	frekuensi: string;
	hari_generate: number;
	reminder_days?: number;
	tanggal_mulai?: string;
	tanggal_berakhir?: string;
	project_id?: number;
	department?: string;
	is_active: boolean;
	last_generated_period?: string;
	attachment_file?: string;
	// Computed client-side
	daysRemaining?: number;
	isDueSoon?: boolean;
	periodKey?: string;
	existingDraftId?: number | null;
}

function nowWib(): Date {
	return new Date(Date.now() + 7 * 60 * 60 * 1000);
}

function computePeriodKey(freq: string, d: Date): string {
	if (freq === 'mingguan') {
		const target = new Date(d.getTime());
		target.setUTCDate(target.getUTCDate() + 4 - (target.getUTCDay() || 7));
		const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
		const weekNo = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
		return `${target.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
	}
	if (freq === 'tahunan') return String(d.getUTCFullYear());
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function getProjectRecurringExpenses(projectIds?: number[]): Promise<ProjectRecurringItem[]> {
	try {
		const filter: Record<string, any> = {
			is_active: { _eq: true }
		};

		if (projectIds && projectIds.length > 0) {
			filter.project_id = { _in: projectIds };
		}

		const items: any = await directus.request(
			readItems('recurring_expenses', {
				filter,
				sort: ['hari_generate'],
				limit: 50
			})
		);

		const today = nowWib();
		const dayOfMonth = today.getUTCDate();

		const computedItems: ProjectRecurringItem[] = (items || []).map((item: any) => {
			const freq = item.frekuensi || 'bulanan';
			const periodKey = computePeriodKey(freq, today);
			const targetDay = Number(item.hari_generate) || 1;
			const reminderDays = Number(item.reminder_days) >= 0 ? Number(item.reminder_days) : 7;

			let daysRemaining = targetDay - dayOfMonth;
			if (daysRemaining < 0) {
				daysRemaining += 30; // Siklus berikutnya
			}

			const isDueSoon = daysRemaining <= reminderDays;

			return {
				...item,
				daysRemaining,
				isDueSoon,
				periodKey
			};
		});

		return computedItems;
	} catch (error) {
		console.warn('Gagal memuat recurring expenses proyek:', error);
		return [];
	}
}

export async function createDraftFromRecurring(item: ProjectRecurringItem, pengajuName?: string): Promise<number | null> {
	try {
		const today = nowWib();
		const todayIso = today.toISOString().slice(0, 10);
		const periodKey = item.periodKey || computePeriodKey(item.frekuensi || 'bulanan', today);

		const payload: any = {
			status: 'Draft',
			nama_pengaju: pengajuName || 'Project Leader',
			department: item.department || 'PROJECT',
			kategori: item.kategori || 'operasional',
			urgency: 'Normal',
			tujuan_pengajuan: `[Biaya Rutin] ${item.nama_pengeluaran} — Periode ${periodKey}`,
			tanggal_dibutuhkan: todayIso,
			total_amount: Number(item.nominal) || 0,
			project_id: item.project_id || null,
			penerima_dana_nama: item.vendor_penerima || item.nama_pengeluaran,
			comments: `Draf otomatis biaya berulang periode ${periodKey}. Silakan review kelengkapan data & kirim pengajuan.`,
			lampiran_exception_note: item.attachment_file ? `File lampiran ID: ${item.attachment_file}` : null
		};

		const res: any = await directus.request(createItem('pengajuan_anggaran', payload));
		return res?.id || null;
	} catch (error) {
		handleDirectusError(error);
		throw error;
	}
}
