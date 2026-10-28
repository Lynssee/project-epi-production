<!-- src/lib/components/support/QuickSupportModal.svelte — Quick support ticket popup for project-epi (Svelte 5) -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount, onDestroy, untrack } from 'svelte';
	import { fade } from 'svelte/transition';
	import { authStore } from '$lib/stores/auth';
	import { get as getStore } from 'svelte/store';
	import { createFieldTicket, uploadTicketPhoto, uploadMultipleTicketPhotos, parseLampiranIds, getMyTickets, getAllTickets, getTicketLogs, toggleTicketLogCompletion, updateTicketLog, deleteTicketLog, updateSupportTicket, type SupportTicketRow, type SupportTicketLog } from '$lib/services/support';
	import { resolveOperatorId } from '$lib/services/preventive';
	import { getAllKaryawan, type Karyawan } from '$lib/services/karyawan';
	import { IconHeadset, IconUpload, IconTrash, IconLoader2, IconX, IconChevronRight, IconChevronDown, IconClock, IconSearch } from '@tabler/icons-svelte';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';

	let { show = $bindable(false), initialTab = 'create' } = $props();

	const DEPARTEMEN = ['IT', 'HRD', 'Maintenance', 'Finance', 'Procurement', 'Project', 'QC', 'Produksi', 'Inventory', 'Logistik', 'Ciketing', 'Sales', 'Revenue Ops', 'Fleet', 'Marketing', 'GA', 'Lainnya'];
	const PRIORITAS = ['Rendah', 'Sedang', 'Tinggi', 'Urgent'];
	const DIRECTUS_URL = import.meta.env.VITE_DIRECTUS_API_URL;

	let loading = $state(false);
	let uploadingFile = $state(false);

	let targetDept = $state('IT');
	let category = $state('');
	let subject = $state('');
	let description = $state('');
	let priority = $state('Sedang');
	let selectedPic = $state('');
	let allKaryawan = $state<Karyawan[]>([]);

	// Jaring pengaman draf untuk tab "Buat Tiket". Modal ini terpasang global di
	// layout, jadi bisa dibuka dari mana saja — termasuk saat user di lapangan
	// melampirkan foto lewat kamera, titik di mana OS bisa membunuh tab.
	interface QuickTiketDraft {
		targetDept: string;
		category: string;
		subject: string;
		description: string;
		priority: string;
		selectedPic: string;
		fileCount: number;
	}
	const quickPersist = createFormPersist<QuickTiketDraft>('quick_support_tiket');
	let draftSavedAt = $state<Date | null>(null);
	let draftArmed = $state(false);

	function quickSnapshot(): QuickTiketDraft {
		return { targetDept, category, subject, description, priority, selectedPic, fileCount: selectedFiles.length };
	}

	/** Tulis ulang SEMUA lampiran ke IndexedDB; dipanggil tiap daftar lampiran berubah. */
	async function persistAttachments() {
		await quickPersist.clearPhotos();
		await Promise.all(selectedFiles.map((it, i) => quickPersist.savePhoto(`lampiran_${i}`, it.file)));
	}

	let filteredKaryawan = $derived.by(() => {
		if (!targetDept) return [];
		const target = targetDept.toLowerCase();
		return allKaryawan.filter(k => {
			if (k.status === 'Off' || (k as any).status_kerja === 'Tidak Aktif') return false;
			if (!k.divisi) return false;
			const div = k.divisi.toLowerCase();
			if (target === 'it') {
				return div.includes('it') || div.includes('media');
			}
			if (target === 'hrd') {
				return div.includes('hrd') || div.includes('general');
			}
			if (target === 'maintenance') {
				return div.includes('maintenance') || div.includes('perawatan') || div.includes('mekanik');
			}
			if (target === 'finance') {
				return div.includes('finance') || div.includes('accounting') || div.includes('keuangan');
			}
			if (target === 'procurement') {
				return div.includes('procurement') || div.includes('pembelian') || div.includes('purchasing');
			}
			if (target === 'project') {
				return div.includes('project') || div.includes('proyek') || div.includes('man power');
			}
			if (target === 'qc') {
				return div.includes('qc') || div.includes('quality') || div.includes('laboratorium');
			}
			if (target === 'produksi') {
				return div.includes('produksi') || div.includes('production') || div.includes('pabrik') || div.includes('manufacture');
			}
			if (target === 'logistik' || target === 'inventory') {
				return div.includes('logistik') || div.includes('logistic') || div.includes('gudang') || div.includes('inventory');
			}
			if (target === 'ciketing') {
				return div.includes('ciketing');
			}
			if (target === 'sales') {
				return div.includes('sales') || div.includes('marketing');
			}
			return div.includes(target) || target === 'lainnya';
		});
	});

	const PRESET_TAGS: Record<string, string[]> = {
		IT: ['Printer', 'SAP', 'Network/Wifi', 'Email', 'Absensi', 'Hardware', 'Software', 'User Account', 'Sistem Error'],
		HRD: ['Absensi', 'Payroll', 'Cuti', 'Klaim/Reimburse', 'Karyawan', 'BPJS'],
		Maintenance: ['AC/Pendingin', 'Listrik', 'Mesin', 'Gedung', 'Kendaraan', 'Pipa/Air'],
		Finance: ['Invoice', 'Pembayaran', 'Kas', 'Laporan', 'Pajak'],
		Procurement: ['PO', 'Supplier', 'Stok Baraya', 'Material'],
		Sales: ['Lead', 'Customer', 'SO/PO', 'Harga'],
		GA: ['ATK', 'Kebersihan', 'Fasilitas', 'Kendaraan Operasional'],
		Default: ['Printer', 'SAP', 'Network/Wifi', 'Email', 'Absensi', 'Hardware', 'Software', 'Sistem Error']
	};

	function getPopularTags(dept: string) {
		return PRESET_TAGS[dept] || PRESET_TAGS.Default;
	}

	function toggleTag(tag: string) {
		const currentTags = category
			? category.split(',').map(t => t.trim()).filter(Boolean)
			: [];
		
		const index = currentTags.findIndex(t => t.toLowerCase() === tag.toLowerCase());
		if (index >= 0) {
			currentTags.splice(index, 1);
		} else {
			currentTags.push(tag);
		}
		category = currentTags.join(', ');
	}

	function isTagSelected(tag: string) {
		if (!category) return false;
		const currentTags = category.split(',').map(t => t.trim().toLowerCase());
		return currentTags.includes(tag.toLowerCase());
	}

	interface AttachedFileItem {
		id: string;
		file: File;
		previewUrl: string;
		name: string;
		size: number;
		isImage: boolean;
	}

	let selectedFiles = $state<AttachedFileItem[]>([]);
	let dropActive = $state(false);

	let activeTab = $state<'create' | 'mine' | 'all'>('create');
	let tickets = $state<SupportTicketRow[]>([]);
	let loadingTickets = $state(false);
	let ticketsError = $state('');
	let expandedTicketId = $state<string | null>(null);
	let ticketLogs = $state<Record<string, SupportTicketLog[]>>({});

	let focusedTicketIds = $state<string[]>((() => {
		if (typeof window === 'undefined') return [];
		const val = localStorage.getItem('focused_ticket_ids');
		if (val) {
			try {
				const parsed = JSON.parse(val);
				if (Array.isArray(parsed)) return parsed.map(String);
			} catch (e) {
				// ignore
			}
		}
		const oldVal = localStorage.getItem('focused_ticket_id');
		if (oldVal) {
			return [String(oldVal)];
		}
		return [];
	})());

	let customTicketOrder = $state<string[]>((() => {
		if (typeof window === 'undefined') return [];
		const val = localStorage.getItem('custom_ticket_order');
		if (val) {
			try {
				const parsed = JSON.parse(val);
				if (Array.isArray(parsed)) return parsed.map(String);
			} catch (e) {
				// ignore
			}
		}
		return [];
	})());

	let draggedTicketId = $state<string | null>(null);
	let dragOverTicketId = $state<string | null>(null);

	function handleCardDragStart(e: DragEvent, ticketId: string | number) {
		const target = e.target as HTMLElement | null;
		if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.tagName === 'BUTTON' || target.closest('button') || target.closest('a'))) {
			e.preventDefault();
			return;
		}
		draggedTicketId = String(ticketId);
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', String(ticketId));
		}
	}

	function handleCardDragOver(e: DragEvent, ticketId: string | number) {
		e.preventDefault();
		if (e.dataTransfer) {
			e.dataTransfer.dropEffect = 'move';
		}
		if (draggedTicketId && draggedTicketId !== String(ticketId)) {
			dragOverTicketId = String(ticketId);
		}
	}

	function handleCardDragLeave(e: DragEvent, ticketId: string | number) {
		if (dragOverTicketId === String(ticketId)) {
			dragOverTicketId = null;
		}
	}

	function handleCardDrop(e: DragEvent, targetTicketId: string | number) {
		e.preventDefault();
		const sourceId = draggedTicketId;
		const targetId = String(targetTicketId);

		if (!sourceId || sourceId === targetId) {
			draggedTicketId = null;
			dragOverTicketId = null;
			return;
		}

		reorderTickets(sourceId, targetId);

		draggedTicketId = null;
		dragOverTicketId = null;
	}

	function handleCardDragEnd() {
		draggedTicketId = null;
		dragOverTicketId = null;
	}

	function reorderTickets(sourceId: string, targetId: string) {
		const currentList = [...filteredTickets];
		const sourceIndex = currentList.findIndex(t => String(t.id) === String(sourceId));
		const targetIndex = currentList.findIndex(t => String(t.id) === String(targetId));

		if (sourceIndex === -1 || targetIndex === -1) return;

		const [movedItem] = currentList.splice(sourceIndex, 1);
		currentList.splice(targetIndex, 0, movedItem);

		const newOrderIds = currentList.map(t => String(t.id));

		const remainingIds = customTicketOrder.filter(id => !newOrderIds.includes(String(id)));
		customTicketOrder = [...newOrderIds, ...remainingIds];

		if (typeof window !== 'undefined') {
			localStorage.setItem('custom_ticket_order', JSON.stringify(customTicketOrder));
		}

		const sourceFocused = focusedTicketIds.includes(String(sourceId));
		const targetFocused = focusedTicketIds.includes(String(targetId));
		if (sourceFocused && targetFocused) {
			const newFocusedOrder = newOrderIds.filter(id => focusedTicketIds.includes(String(id)));
			const otherFocused = focusedTicketIds.filter(id => !newFocusedOrder.includes(String(id)));
			focusedTicketIds = [...newFocusedOrder, ...otherFocused];
			if (typeof window !== 'undefined') {
				localStorage.setItem('focused_ticket_ids', JSON.stringify(focusedTicketIds));
			}
		}
	}

	function toggleFocusMode(ticketId: string | number) {
		const targetIdStr = String(ticketId);
		if (focusedTicketIds.includes(targetIdStr)) {
			focusedTicketIds = focusedTicketIds.filter(id => id !== targetIdStr);
			if (typeof window !== 'undefined') {
				localStorage.setItem('focused_ticket_ids', JSON.stringify(focusedTicketIds));
			}
			toast.info('Focus mode dinonaktifkan.');
		} else {
			if (focusedTicketIds.length >= 5) {
				toast.error('Maksimal 5 tiket yang dapat difokuskan!');
				return;
			}
			focusedTicketIds = [...focusedTicketIds, targetIdStr];
			if (typeof window !== 'undefined') {
				localStorage.setItem('focused_ticket_ids', JSON.stringify(focusedTicketIds));
			}
			toast.success('Focus mode diaktifkan.');
		}
	}

	let searchQuery = $state('');
	let selectedFilterPic = $state('');
	let selectedFilterPengaju = $state('');
	let selectedFilterDept = $state('');
	let selectedSortBy = $state<'newest' | 'oldest' | 'priority_desc' | 'priority_asc' | 'ticket_asc' | 'ticket_desc'>('newest');

	function resetAllFilters() {
		searchQuery = '';
		selectedFilterPic = '';
		selectedFilterPengaju = '';
		selectedFilterDept = '';
		selectedSortBy = 'newest';
	}

	let availablePics = $derived.by(() => {
		const set = new Set<string>();
		for (const t of tickets) {
			if (t.pic && t.pic.trim()) set.add(t.pic.trim());
		}
		return Array.from(set).sort((a, b) => a.localeCompare(b));
	});

	let availablePengajus = $derived.by(() => {
		const set = new Set<string>();
		for (const t of tickets) {
			const name = t.pelapor_nama || t.pelapor_id;
			if (name && name.trim()) set.add(name.trim());
		}
		return Array.from(set).sort((a, b) => a.localeCompare(b));
	});

	let availableDepts = $derived.by(() => {
		const set = new Set<string>(DEPARTEMEN);
		for (const t of tickets) {
			if (t.departemen_tujuan && t.departemen_tujuan.trim()) set.add(t.departemen_tujuan.trim());
		}
		return Array.from(set).sort((a, b) => a.localeCompare(b));
	});

	let filteredTickets = $derived.by(() => {
		const q = searchQuery.toLowerCase().trim();
		let list = tickets;
		if (q) {
			list = tickets.filter(t => 
				(t.nomor_tiket && t.nomor_tiket.toLowerCase().includes(q)) ||
				(t.judul && t.judul.toLowerCase().includes(q)) ||
				(t.deskripsi && t.deskripsi.toLowerCase().includes(q)) ||
				(t.kategori && t.kategori.toLowerCase().includes(q)) ||
				(t.departemen_tujuan && t.departemen_tujuan.toLowerCase().includes(q)) ||
				(t.pic && t.pic.toLowerCase().includes(q)) ||
				(t.pelapor_nama && t.pelapor_nama.toLowerCase().includes(q)) ||
				(t.pelapor_id && t.pelapor_id.toLowerCase().includes(q)) ||
				(t.solusi && t.solusi.toLowerCase().includes(q)) ||
				(t.catatan_verifikasi && t.catatan_verifikasi.toLowerCase().includes(q)) ||
				(t.lokasi && t.lokasi.toLowerCase().includes(q)) ||
				(t.verified_by && t.verified_by.toLowerCase().includes(q))
			);
		}

		if (selectedFilterPic) {
			list = list.filter(t => t.pic === selectedFilterPic);
		}

		if (selectedFilterPengaju) {
			list = list.filter(t => (t.pelapor_nama === selectedFilterPengaju || t.pelapor_id === selectedFilterPengaju));
		}

		if (selectedFilterDept) {
			list = list.filter(t => t.departemen_tujuan === selectedFilterDept);
		}

		const priorityRank: Record<string, number> = { 'Urgent': 4, 'Tinggi': 3, 'Sedang': 2, 'Rendah': 1 };
		list = [...list].sort((a, b) => {
			if (selectedSortBy === 'oldest') {
				const dA = new Date(a.tanggal || a.date_created || 0).getTime();
				const dB = new Date(b.tanggal || b.date_created || 0).getTime();
				return dA - dB || String(a.id).localeCompare(String(b.id));
			} else if (selectedSortBy === 'priority_desc') {
				const pA = priorityRank[a.prioritas] || 0;
				const pB = priorityRank[b.prioritas] || 0;
				if (pA !== pB) return pB - pA;
				return new Date(b.tanggal || b.date_created || 0).getTime() - new Date(a.tanggal || a.date_created || 0).getTime();
			} else if (selectedSortBy === 'priority_asc') {
				const pA = priorityRank[a.prioritas] || 0;
				const pB = priorityRank[b.prioritas] || 0;
				if (pA !== pB) return pA - pB;
				return new Date(b.tanggal || b.date_created || 0).getTime() - new Date(a.tanggal || a.date_created || 0).getTime();
			} else if (selectedSortBy === 'ticket_asc') {
				return (a.nomor_tiket || '').localeCompare(b.nomor_tiket || '');
			} else if (selectedSortBy === 'ticket_desc') {
				return (b.nomor_tiket || '').localeCompare(a.nomor_tiket || '');
			} else {
				const dA = new Date(a.tanggal || a.date_created || 0).getTime();
				const dB = new Date(b.tanggal || b.date_created || 0).getTime();
				return dB - dA || String(b.id).localeCompare(String(a.id));
			}
		});

		if (customTicketOrder.length > 0) {
			list = [...list].sort((a, b) => {
				const idxA = customTicketOrder.indexOf(String(a.id));
				const idxB = customTicketOrder.indexOf(String(b.id));
				if (idxA !== -1 && idxB !== -1) return idxA - idxB;
				if (idxA !== -1) return -1;
				if (idxB !== -1) return 1;
				return 0;
			});
		}

		if (focusedTicketIds.length > 0) {
			const focusedItems: SupportTicketRow[] = [];
			const rest: SupportTicketRow[] = [];
			for (const t of list) {
				if (focusedTicketIds.includes(String(t.id))) {
					focusedItems.push(t);
				} else {
					rest.push(t);
				}
			}
			return [...focusedItems, ...rest];
		}
		return list;
	});

	function getChecklistStats(logs: SupportTicketLog[] = []) {
		if (!logs || logs.length === 0) return { total: 0, completed: 0, percent: 0 };
		const progressLogs = logs.filter(l => l.tipe === 'Progress' || l.tipe === 'Status' || l.tipe === 'Verifikasi' || l.is_completed !== undefined);
		if (progressLogs.length === 0) return { total: 0, completed: 0, percent: 0 };
		const completed = progressLogs.filter(l => Boolean(l.is_completed)).length;
		const percent = Math.round((completed / progressLogs.length) * 100);
		return { total: progressLogs.length, completed, percent };
	}

	async function toggleLogCompleted(logItem: SupportTicketLog, ticketId: string) {
		const newStatus = !logItem.is_completed;
		if (ticketLogs[ticketId]) {
			ticketLogs[ticketId] = ticketLogs[ticketId].map(l => l.id === logItem.id ? { ...l, is_completed: newStatus } : l);
		}

		try {
			await toggleTicketLogCompletion(logItem.id, newStatus);
			toast.success(newStatus ? 'Progress ditandai Selesai ✓' : 'Progress ditandai Belum Selesai');
		} catch (err) {
			console.error(err);
			if (ticketLogs[ticketId]) {
				ticketLogs[ticketId] = ticketLogs[ticketId].map(l => l.id === logItem.id ? { ...l, is_completed: !newStatus } : l);
			}
			toast.error('Gagal memperbarui status checklist.');
		}
	}

	let editingLogId = $state<string | null>(null);
	let editingLogCatatan = $state('');
	let editingLogCompleted = $state(false);
	let editingLogAttachment = $state<string | null>(null);
	let editingLogNewFile = $state<File | null>(null);
	let editingLogPreviewUrl = $state('');
	let savingEditLog = $state(false);

	function startEditLog(l: SupportTicketLog) {
		editingLogId = l.id;
		editingLogCatatan = l.catatan || '';
		editingLogCompleted = Boolean(l.is_completed);
		editingLogAttachment = l.lampiran || null;
		editingLogNewFile = null;
		if (editingLogPreviewUrl) URL.revokeObjectURL(editingLogPreviewUrl);
		editingLogPreviewUrl = '';
	}

	function cancelEditLog() {
		editingLogId = null;
		editingLogCatatan = '';
		editingLogCompleted = false;
		editingLogAttachment = null;
		editingLogNewFile = null;
		if (editingLogPreviewUrl) URL.revokeObjectURL(editingLogPreviewUrl);
		editingLogPreviewUrl = '';
	}

	function handleEditFileChange(e: Event) {
		const target = e.target as HTMLInputElement;
		if (target.files && target.files[0]) {
			editingLogNewFile = target.files[0];
			if (editingLogPreviewUrl) URL.revokeObjectURL(editingLogPreviewUrl);
			editingLogPreviewUrl = URL.createObjectURL(target.files[0]);
		}
	}

	function removeEditFile() {
		editingLogNewFile = null;
		editingLogAttachment = null;
		if (editingLogPreviewUrl) URL.revokeObjectURL(editingLogPreviewUrl);
		editingLogPreviewUrl = '';
	}

	async function saveEditLog(logItem: SupportTicketLog, ticketId: string) {
		if (!editingLogCatatan.trim()) {
			toast.error('Catatan progress wajib diisi!');
			return;
		}
		savingEditLog = true;
		try {
			let fileId = editingLogAttachment;
			if (editingLogNewFile) {
				fileId = await uploadTicketPhoto(editingLogNewFile);
			}

			await updateTicketLog(logItem.id, {
				catatan: editingLogCatatan.trim(),
				is_completed: Boolean(editingLogCompleted),
				lampiran: fileId
			});

			toast.success('Progress berhasil diperbarui.');
			if (ticketLogs[ticketId]) {
				ticketLogs[ticketId] = ticketLogs[ticketId].map(l => l.id === logItem.id ? {
					...l,
					catatan: editingLogCatatan.trim(),
					is_completed: Boolean(editingLogCompleted),
					lampiran: fileId
				} : l);
			}
			cancelEditLog();
		} catch (err) {
			console.error(err);
			toast.error('Gagal mengupdate progress.');
		} finally {
			savingEditLog = false;
		}
	}

	// States & functions for editing ticket details
	let editingTicketId = $state<string | null>(null);
	let editSubject = $state('');
	let editTargetDept = $state('IT');
	let editCategory = $state('');
	let editPriority = $state('Sedang');
	let editDescription = $state('');
	let editAttachment = $state<string | null>(null);
	let editNewFile = $state<File | null>(null);
	let editPreviewUrl = $state('');
	let savingTicketEdit = $state(false);

	function startEditTicket(t: SupportTicketRow) {
		editingTicketId = t.id;
		editSubject = t.judul || '';
		editTargetDept = t.departemen_tujuan || 'IT';
		editCategory = t.kategori || '';
		editPriority = t.prioritas || 'Sedang';
		editDescription = t.deskripsi || '';
		editAttachment = t.lampiran || null;
		editNewFile = null;
		if (editPreviewUrl) URL.revokeObjectURL(editPreviewUrl);
		editPreviewUrl = '';
	}

	function cancelEditTicket() {
		editingTicketId = null;
		editSubject = '';
		editTargetDept = 'IT';
		editCategory = '';
		editPriority = 'Sedang';
		editDescription = '';
		editAttachment = null;
		editNewFile = null;
		if (editPreviewUrl) URL.revokeObjectURL(editPreviewUrl);
		editPreviewUrl = '';
	}

	function handleEditTicketFileChange(e: Event) {
		const target = e.target as HTMLInputElement;
		if (target.files && target.files[0]) {
			processEditTicketFile(target.files[0]);
		}
	}

	function processEditTicketFile(file: File) {
		editNewFile = file;
		if (editPreviewUrl) URL.revokeObjectURL(editPreviewUrl);
		editPreviewUrl = URL.createObjectURL(file);
	}

	function removeEditTicketFile() {
		editNewFile = null;
		editAttachment = null;
		if (editPreviewUrl) URL.revokeObjectURL(editPreviewUrl);
		editPreviewUrl = '';
	}

	async function saveTicketEdit(ticketId: string) {
		if (!editSubject.trim()) {
			toast.error('Judul masalah wajib diisi!');
			return;
		}
		if (!editDescription.trim()) {
			toast.error('Deskripsi detail kendala wajib diisi!');
			return;
		}

		savingTicketEdit = true;
		try {
			let fileId = editAttachment;
			if (editNewFile) {
				fileId = await uploadTicketPhoto(editNewFile);
			}

			const payload: Partial<SupportTicketRow> = {
				judul: editSubject.trim(),
				departemen_tujuan: editTargetDept,
				kategori: editCategory.trim() || null,
				prioritas: editPriority,
				deskripsi: editDescription.trim(),
				lampiran: fileId
			};

			const auth = getStore(authStore);
			const actorName = auth?.user?.displayName || auth?.user?.email || 'User';

			await updateSupportTicket(ticketId, payload, actorName);
			toast.success('Isi tiket berhasil diperbarui.');
			tickets = tickets.map(t => t.id === ticketId ? { ...t, ...payload } : t);
			cancelEditTicket();
		} catch (err: any) {
			console.error(err);
			toast.error(err.message || 'Gagal memperbarui isi tiket.');
		} finally {
			savingTicketEdit = false;
		}
	}

	async function confirmDeleteLog(logItem: SupportTicketLog, ticketId: string) {
		if (!confirm('Apakah Anda yakin ingin menghapus entri progress ini?')) return;
		try {
			await deleteTicketLog(logItem.id);
			toast.success('Progress berhasil dihapus.');
			if (ticketLogs[ticketId]) {
				ticketLogs[ticketId] = ticketLogs[ticketId].filter(l => l.id !== logItem.id);
			}
		} catch (err) {
			console.error(err);
			toast.error('Gagal menghapus progress.');
		}
	}
	let loadingLogs = $state<Record<string, boolean>>({});

	async function loadLogsForTicket(ticketId: string) {
		if (ticketLogs[ticketId]) return;
		loadingLogs[ticketId] = true;
		try {
			ticketLogs[ticketId] = await getTicketLogs(ticketId);
		} catch (err) {
			console.error('Gagal memuat log:', err);
		} finally {
			loadingLogs[ticketId] = false;
		}
	}

	function logIcon(tipe: string) {
		switch (tipe) {
			case 'Delegasi': return '➡️';
			case 'Status': return '🔄';
			case 'Verifikasi': return '✅';
			default: return '📝';
		}
	}

	function formatLogDate(d: string | null) {
		if (!d) return '-';
		return new Date(d).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
	}

	const toast = {
		success: (m: string) => (window as any).__showToast?.(m, 'success'),
		error: (m: string) => (window as any).__showToast?.(m, 'error'),
		info: (m: string) => (window as any).__showToast?.(m, 'info')
	};

	$effect(() => {
		if (show) {
			untrack(() => {
				resetAllFilters();
				if (initialTab === 'list') {
					activeTab = 'mine';
				} else {
					activeTab = initialTab as 'create' | 'mine' | 'all';
				}
				
				if (activeTab === 'mine') {
					loadMyTickets();
				} else if (activeTab === 'all') {
					loadAllTickets();
				}
			});
		} else {
			untrack(() => {
				resetForm();
			});
		}
	});

	async function loadMyTickets() {
		loadingTickets = true;
		ticketsError = '';
		try {
			const karyawanName = getStore(authStore)?.karyawanName;
			if (!karyawanName) throw new Error('Nama pelapor tidak ditemukan di sesi login.');
			const personnelId = await resolveOperatorId(karyawanName);
			tickets = await getMyTickets(personnelId);
		} catch (err: any) {
			console.error(err);
			ticketsError = err?.message || 'Gagal memuat tiket support Anda.';
		} finally {
			loadingTickets = false;
		}
	}

	async function loadAllTickets() {
		loadingTickets = true;
		ticketsError = '';
		try {
			tickets = await getAllTickets();
		} catch (err: any) {
			console.error(err);
			ticketsError = err?.message || 'Gagal memuat semua tiket support.';
		} finally {
			loadingTickets = false;
		}
	}


	function verifikasiBadge(v: string) {
		if (v === 'Ditolak') return { bg: 'var(--rel)', color: 'var(--red)', label: 'Ditolak' };
		if (v === 'Terverifikasi') return { bg: 'var(--gg)', color: 'var(--ggd)', label: 'Terverifikasi' };
		return { bg: 'var(--aml)', color: 'var(--amd)', label: 'Menunggu Verifikasi' };
	}

	function statusBadge(status: string) {
		const map: Record<string, { bg: string; color: string }> = {
			'Open': { bg: 'var(--pl)', color: 'var(--pd)' },
			'In Progress': { bg: '#DBEAFE', color: '#1D4ED8' },
			'Resolved': { bg: 'var(--gg)', color: 'var(--ggd)' },
			'Closed': { bg: 'var(--sys-fill)', color: 'var(--sys-label3)' },
			'Cancelled': { bg: 'var(--rel)', color: 'var(--red)' }
		};
		return map[status] || { bg: 'var(--sys-fill)', color: 'var(--sys-label3)' };
	}

	function umurHari(tanggal: string | null | undefined) {
		if (!tanggal) return 0;
		const diff = Date.now() - new Date(tanggal).getTime();
		return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
	}

	function formatSubmitTime(dateString: string | null | undefined) {
		if (!dateString) return '';
		try {
			const str = String(dateString).trim();
			if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return '';
			const d = new Date(str);
			if (isNaN(d.getTime())) return '';
			const hours = String(d.getHours()).padStart(2, '0');
			const minutes = String(d.getMinutes()).padStart(2, '0');
			return `${hours}:${minutes}`;
		} catch (e) {
			return '';
		}
	}

	function toggleExpandTicket(id: string) {
		if (expandedTicketId === id) {
			expandedTicketId = null;
		} else {
			expandedTicketId = id;
			loadLogsForTicket(id);
		}
	}


	function resetForm() {
		targetDept = 'IT';
		category = '';
		subject = '';
		description = '';
		priority = 'Sedang';
		selectedPic = '';
		removeAllFiles();
		activeTab = 'create';
		expandedTicketId = null;
		searchQuery = '';
	}

	function addFiles(fileList: FileList | File[] | null) {
		if (!fileList || fileList.length === 0) return;
		const filesArr = Array.from(fileList);
		const newItems: AttachedFileItem[] = [];

		for (const file of filesArr) {
			const isImg = file.type.startsWith('image/');
			const item: AttachedFileItem = {
				id: Math.random().toString(36).substring(2, 9) + Date.now(),
				file,
				previewUrl: isImg ? URL.createObjectURL(file) : '',
				name: file.name,
				size: file.size,
				isImage: isImg
			};
			newItems.push(item);
		}

		selectedFiles = [...selectedFiles, ...newItems];
		if (newItems.length > 0) {
			toast.success(`${newItems.length} lampiran ditambahkan.`);
		}
		persistAttachments();
	}

	function removeFileItem(id: string) {
		const found = selectedFiles.find(item => item.id === id);
		if (found && found.previewUrl) {
			URL.revokeObjectURL(found.previewUrl);
		}
		selectedFiles = selectedFiles.filter(item => item.id !== id);
		persistAttachments();
	}

	function removeAllFiles() {
		for (const item of selectedFiles) {
			if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
		}
		selectedFiles = [];
	}

	function handleFileChange(e: Event) {
		const target = e.target as HTMLInputElement;
		if (target.files) {
			addFiles(target.files);
			target.value = '';
		}
	}

	function handleGlobalPaste(e: ClipboardEvent) {
		if (!show) return;
		const items = e.clipboardData?.items;
		if (!items) return;
		const pastedFiles: File[] = [];
		for (const item of items) {
			if (item.type.indexOf('image') !== -1) {
				const file = item.getAsFile();
				if (file) pastedFiles.push(file);
			}
		}
		if (pastedFiles.length > 0) {
			addFiles(pastedFiles);
			toast.success(`${pastedFiles.length} screenshot ditempel dari clipboard!`);
			e.preventDefault();
		}
	}

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
		dropActive = true;
	}

	function handleDragLeave() {
		dropActive = false;
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		dropActive = false;
		if (e.dataTransfer?.files) {
			addFiles(e.dataTransfer.files);
		}
	}

	async function handleSubmit() {
		if (!subject.trim()) {
			toast.error('Judul tiket wajib diisi!');
			return;
		}
		if (!description.trim()) {
			toast.error('Deskripsi detail masalah wajib diisi!');
			return;
		}

		loading = true;
		try {
			let lampiranValue: string | null = null;
			if (selectedFiles.length > 0) {
				uploadingFile = true;
				const uploadedIds = await uploadMultipleTicketPhotos(selectedFiles.map(f => f.file));
				uploadingFile = false;
				if (uploadedIds.length > 0) {
					lampiranValue = uploadedIds.length === 1 ? uploadedIds[0] : JSON.stringify(uploadedIds);
				} else {
					toast.error('Gagal mengunggah lampiran. Melanjutkan tanpa lampiran.');
				}
			}

			const pelaporName = getStore(authStore)?.karyawanName || getStore(authStore)?.user?.email || 'User Lapangan';
			const pelaporId = getStore(authStore)?.user?.email || 'lapangan';

			const payload = {
				tipe: 'Permintaan',
				judul: subject.trim(),
				deskripsi: description.trim(),
				prioritas: priority,
				departemen_tujuan: targetDept,
				kategori: category.trim() || null,
				pelapor_nama: pelaporName,
				pelapor_id: pelaporId,
				lampiran: lampiranValue,
				pic: selectedPic || null
			};

			const created = await createFieldTicket(payload);
			if (created && created.id) {
				// Terkirim — draf lokal (termasuk lampiran di IndexedDB) sudah tidak relevan.
				// Harus dibersihkan SEBELUM `show = false`, karena penutupan modal memanggil
				// resetForm() yang mengosongkan field dan memicu autosave.
				quickPersist.clear();
				await quickPersist.clearPhotos();
				draftSavedAt = null;
				toast.success(`Tiket berhasil dibuat: ${created.nomor_tiket}`);
				show = false;
			} else {
				throw new Error('Gagal membuat tiket support.');
			}
		} catch (error: any) {
			console.error(error);
			toast.error(error.message || 'Terjadi kesalahan saat mengirim tiket.');
		} finally {
			loading = false;
			uploadingFile = false;
		}
	}

	onMount(async () => {
		window.addEventListener('paste', handleGlobalPaste);
		try {
			allKaryawan = await getAllKaryawan();
		} catch (err) {
			console.error('Gagal mengambil data karyawan:', err);
		}

		const draft = quickPersist.restore();
		if (draft) {
			targetDept = draft.targetDept;
			category = draft.category;
			subject = draft.subject;
			description = draft.description;
			priority = draft.priority;
			selectedPic = draft.selectedPic;

			const blobs = await Promise.all(
				Array.from({ length: draft.fileCount || 0 }, (_, i) => quickPersist.restorePhoto(`lampiran_${i}`))
			);
			selectedFiles = blobs
				.map((b, i) => {
					if (!b) return null;
					const isImg = (b.type || '').startsWith('image/');
					const ext = b.type === 'application/pdf' ? 'pdf' : 'jpg';
					const file = new File([b], `lampiran_${i}.${ext}`, { type: b.type || 'image/jpeg' });
					return {
						id: Math.random().toString(36).substring(2, 9) + Date.now(),
						file,
						previewUrl: isImg ? URL.createObjectURL(file) : '',
						name: file.name,
						size: file.size,
						isImage: isImg
					} as AttachedFileItem;
				})
				.filter((f): f is AttachedFileItem => !!f);
			draftSavedAt = new Date();
		}
		draftArmed = true;
	});

	// Autosave — baru aktif setelah draf lama sempat dipulihkan, biar tidak menimpanya.
	// Catatan: menutup modal memanggil resetForm(), jadi draf ikut terhapus — itu
	// perilaku lama yang dipertahankan (tutup = buang isian, bukan simpan).
	$effect(() => {
		void quickSnapshot();
		if (!draftArmed) return;
		quickPersist.save(quickSnapshot());
		draftSavedAt = new Date();
	});

	$effect(() => registerFormPersistSaveTriggers(quickPersist, quickSnapshot));

	onDestroy(() => {
		window.removeEventListener('paste', handleGlobalPaste);
		removeAllFiles();
	});
</script>

{#if show}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element-interactions -->
	<div
		class="quick-support-overlay"
		transition:fade={{ duration: 120 }}
		onclick={(e) => { if (e.target === e.currentTarget) show = false; }}
	>
		<div class="quick-support-panel">
			<!-- Header -->
			<div class="quick-support-header">
				<div class="flex items-center gap-2">
					<IconHeadset size={20} class="text-[var(--p, #1F6592)]" />
					<div class="text-left">
						<h3 class="panel-title">
							{activeTab === 'create' 
								? 'Kirim Tiket Bantuan / Perbaikan' 
								: activeTab === 'mine' 
									? 'Tiket Saya' 
									: 'Semua Kendala'}
						</h3>
						<p class="panel-subtitle">
							{activeTab === 'create' 
								? 'Ada kendala sistem atau butuh bantuan? Laporkan di sini.' 
								: activeTab === 'mine' 
									? 'Daftar komplain dan kendala yang Anda laporkan.' 
									: 'Daftar keseluruhan komplain dan kendala.'}
						</p>
						{#if activeTab === 'create'}
							<DraftIndicator savedAt={draftSavedAt} hasPhotos={selectedFiles.length > 0} />
						{/if}
					</div>
				</div>
				<button type="button" class="btn-close" onclick={() => (show = false)} aria-label="Tutup">
					<IconX size={18} />
				</button>
			</div>

			<!-- Tabs -->
			<div class="quick-support-tabs">
				<button 
					type="button" 
					class="support-tab {activeTab === 'create' ? 'active' : ''}" 
					onclick={() => activeTab = 'create'}
				>
					Tulis Tiket Baru
				</button>
				<button 
					type="button" 
					class="support-tab {activeTab === 'mine' ? 'active' : ''}" 
					onclick={() => { activeTab = 'mine'; loadMyTickets(); searchQuery = ''; }}
				>
					Tiket Saya
				</button>
				<button 
					type="button" 
					class="support-tab {activeTab === 'all' ? 'active' : ''}" 
					onclick={() => { activeTab = 'all'; loadAllTickets(); searchQuery = ''; }}
				>
					Semua Kendala
				</button>
			</div>

			<!-- Body -->
			<div class="quick-support-body">
				{#if activeTab === 'create'}
					<!-- Dept & Delegasi -->
					<div class="grid-2">
						<div class="form-group text-left">
							<label class="form-label">Departemen Tujuan <span class="required">*</span></label>
							<select class="form-input" bind:value={targetDept} onchange={() => selectedPic = ''}>
								{#each DEPARTEMEN as d}
									<option value={d}>{d === 'IT' ? '💻 Tim IT' : d}</option>
								{/each}
							</select>
						</div>
						<div class="form-group text-left">
							<label class="form-label">Delegasikan Ke (Opsional)</label>
							<select class="form-input" bind:value={selectedPic}>
								<option value="">— Pilih PIC (Opsional) —</option>
								{#each filteredKaryawan as k}
									<option value={k.nama_karyawan}>{k.nama_karyawan} ({k.posisi || k.divisi || 'Staff'})</option>
								{/each}
							</select>
						</div>
					</div>

					<!-- Bagian & Prioritas -->
					<div class="grid-2">
						<div class="form-group text-left">
							<label class="form-label">Bagian / Fitur Yang Diperbaiki <span class="required">*</span></label>
							<input
								type="text"
								placeholder="Contoh: Printer, SAP, Menu Fleet, Absensi"
								class="form-input font-medium mb-1.5"
								bind:value={category}
							/>
							<!-- Quick Tags -->
							<div class="flex flex-wrap gap-1.5 mt-0.5">
								{#each getPopularTags(targetDept) as tag}
									<button
										type="button"
										onclick={() => toggleTag(tag)}
										class="px-2 py-0.5 rounded-lg text-[10px] font-medium transition-all flex items-center gap-1 border cursor-pointer select-none
											{isTagSelected(tag)
												? 'bg-indigo-600 text-white border-indigo-600 shadow-xs font-semibold'
												: 'bg-slate-100 hover:bg-slate-200 text-slate-600 border-slate-200'}"
									>
										{#if isTagSelected(tag)}
											<span class="text-[9px]">✓</span>
										{:else}
											<span class="text-[9px] text-slate-400">+</span>
										{/if}
										{tag}
									</button>
								{/each}
							</div>
						</div>
						<div class="form-group text-left">
							<label class="form-label">Prioritas</label>
							<select class="form-input" bind:value={priority}>
								{#each PRIORITAS as p}
									<option value={p}>{p}</option>
								{/each}
							</select>
						</div>
					</div>

					<!-- Subject -->
					<div class="form-group text-left">
						<label class="form-label">Judul Masalah <span class="required">*</span></label>
						<input
							type="text"
							placeholder="Ringkasan singkat kendala Anda"
							class="form-input font-bold"
							bind:value={subject}
						/>
					</div>

					<!-- Description -->
					<div class="form-group text-left">
						<label class="form-label">Deskripsi Detail Kendala <span class="required">*</span></label>
						<textarea
							rows={3}
							placeholder="Jelaskan detail kendala Anda, apa yang terjadi, atau apa yang perlu diperbaiki..."
							class="form-textarea"
							bind:value={description}
						></textarea>
					</div>

					<!-- Screenshot Upload -->
					<div class="form-group text-left">
						<div class="flex items-center justify-between mb-1">
							<label class="form-label mb-0">Lampiran / Screenshot Bukti</label>
							{#if selectedFiles.length > 0}
								<button type="button" class="text-[11px] font-semibold text-red-500 hover:text-red-700 transition-colors" onclick={removeAllFiles}>
									Hapus Semua ({selectedFiles.length})
								</button>
							{/if}
						</div>

						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="upload-dropzone {dropActive ? 'active border-indigo-500 bg-indigo-50/30' : ''} mb-2"
							ondragover={handleDragOver}
							ondragleave={handleDragLeave}
							ondrop={handleDrop}
							onclick={() => document.getElementById('field-support-file')?.click()}
						>
							<IconUpload size={24} class="text-[var(--sys-label3)]" />
							<p class="dropzone-text">Tarik file ke sini, atau klik untuk memilih beberapa file</p>
							<p class="dropzone-tip">Tip: Tekan <kbd class="px-1 py-0.5 rounded bg-slate-200 text-slate-700 text-[10px]">Ctrl+V</kbd> di mana saja untuk menempel screenshot dari clipboard</p>
							<input
								type="file"
								id="field-support-file"
								accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.zip"
								multiple
								class="hidden-input"
								onchange={handleFileChange}
							/>
						</div>

						{#if selectedFiles.length > 0}
							<div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 max-h-48 overflow-y-auto p-1.5 border rounded-xl bg-slate-50/50 border-slate-200">
								{#each selectedFiles as item (item.id)}
									<div class="preview-box p-2 rounded-lg border border-slate-200 bg-white flex items-center justify-between shadow-2xs">
										<div class="preview-info flex items-center gap-2 overflow-hidden">
											{#if item.isImage && item.previewUrl}
												<img src={item.previewUrl} alt={item.name} class="w-10 h-10 object-cover rounded-md border border-slate-100 flex-shrink-0" />
											{:else}
												<div class="w-10 h-10 rounded-md bg-slate-100 flex items-center justify-center text-slate-500 font-bold text-[10px] flex-shrink-0 uppercase">
													{item.name.split('.').pop() || 'FILE'}
												</div>
											{/if}
											<div class="preview-text overflow-hidden min-w-0 text-left">
												<p class="file-name text-[11px] font-semibold text-slate-800 truncate" title={item.name}>{item.name}</p>
												<p class="file-size text-[10px] text-slate-400">{(item.size / 1024).toFixed(1)} KB</p>
											</div>
										</div>
										<button type="button" class="p-1 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0 ml-1" onclick={() => removeFileItem(item.id)} title="Hapus file">
											<IconTrash size={14} />
										</button>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{:else}
					<!-- List of Tickets -->
					{#if loadingTickets}
						<CircularProgressGauge size={48} strokeWidth={4} label="Memuat daftar kendala..." />
					{:else if ticketsError}
						<div class="text-center py-12 text-[12px] text-red-500">
							{ticketsError}
						</div>
					{:else}
						<!-- Search bar -->
						<div class="search-wrapper">
							<IconSearch size={16} class="search-icon" />
							<input
								type="text"
								placeholder="Cari nomor tiket, judul, deskripsi, departemen, PIC, pengaju..."
								class="search-input"
								bind:value={searchQuery}
							/>
							{#if searchQuery}
								<button type="button" class="btn-clear-search" onclick={() => searchQuery = ''} aria-label="Bersihkan pencarian">
									<IconX size={14} />
								</button>
							{/if}
						</div>

						<!-- Dropdown Filters: PIC, Pengaju, Departemen, Urutkan -->
						<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 px-1 my-3">
							<!-- Filter PIC -->
							<div class="flex flex-col text-left">
								<label class="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
									👤 PIC
								</label>
								<select
									class="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all"
									bind:value={selectedFilterPic}
								>
									<option value="">— Semua PIC —</option>
									{#each availablePics as pic}
										<option value={pic}>{pic}</option>
									{/each}
								</select>
							</div>

							<!-- Filter Pengaju -->
							<div class="flex flex-col text-left">
								<label class="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
									🙋‍♂️ Pengaju
								</label>
								<select
									class="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all"
									bind:value={selectedFilterPengaju}
								>
									<option value="">— Semua Pengaju —</option>
									{#each availablePengajus as p}
										<option value={p}>{p}</option>
									{/each}
								</select>
							</div>

							<!-- Filter Departemen -->
							<div class="flex flex-col text-left">
								<label class="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
									🏢 Departemen
								</label>
								<select
									class="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all"
									bind:value={selectedFilterDept}
								>
									<option value="">— Semua Departemen —</option>
									{#each availableDepts as d}
										<option value={d}>{d}</option>
									{/each}
								</select>
							</div>

							<!-- Filter Urutkan (Sort By) -->
							<div class="flex flex-col text-left">
								<label class="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
									⇅ URUTKAN
								</label>
								<select
									class="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all"
									bind:value={selectedSortBy}
								>
									<option value="newest">📅 Terbaru</option>
									<option value="oldest">⌛ Terlama</option>
									<option value="priority_desc">⚡ Prioritas (Tinggi - Rendah)</option>
									<option value="priority_asc">💤 Prioritas (Rendah - Tinggi)</option>
									<option value="ticket_asc">🔢 No. Tiket (A - Z)</option>
									<option value="ticket_desc">🔢 No. Tiket (Z - A)</option>
								</select>
							</div>
						</div>

						{#if selectedFilterPic || selectedFilterPengaju || selectedFilterDept || selectedSortBy !== 'newest'}
							<div class="px-1 mb-3 flex items-center justify-between bg-indigo-50/60 border border-indigo-100 p-2 rounded-xl">
								<div class="flex items-center gap-1.5 text-[11px] text-slate-600 font-medium flex-wrap">
									<span class="font-bold text-slate-700">Filter Aktif:</span>
									{#if selectedFilterPic}
										<span class="px-2 py-0.5 bg-sky-100 text-sky-800 rounded-md font-semibold">PIC: {selectedFilterPic}</span>
									{/if}
									{#if selectedFilterPengaju}
										<span class="px-2 py-0.5 bg-purple-100 text-purple-800 rounded-md font-semibold">Pengaju: {selectedFilterPengaju}</span>
									{/if}
									{#if selectedFilterDept}
										<span class="px-2 py-0.5 bg-amber-100 text-amber-800 rounded-md font-semibold">Dept: {selectedFilterDept}</span>
									{/if}
									{#if selectedSortBy !== 'newest'}
										<span class="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-md font-semibold">
											Urutan: {selectedSortBy === 'oldest' ? 'Terlama' : selectedSortBy === 'priority_desc' ? 'Prioritas ↓' : selectedSortBy === 'priority_asc' ? 'Prioritas ↑' : selectedSortBy === 'ticket_asc' ? 'No Tiket (A-Z)' : 'No Tiket (Z-A)'}
										</span>
									{/if}
								</div>
								<button
									type="button"
									class="text-[11px] font-bold text-rose-600 hover:text-rose-800 hover:underline flex items-center gap-1 shrink-0 ml-2"
									onclick={() => { selectedFilterPic = ''; selectedFilterPengaju = ''; selectedFilterDept = ''; selectedSortBy = 'newest'; }}
								>
									✕ Reset Filter
								</button>
							</div>
						{/if}

						{#if filteredTickets.length === 0}
							<div class="flex flex-col items-center justify-center py-16 text-center">
								<IconHeadset size={36} class="text-[var(--sys-label4, #94a3b8)] mb-3" style="margin: 0 auto;" />
								<p class="text-[13px] font-semibold" style="color: var(--sys-label)">Tidak ada tiket ditemukan</p>
								<p class="text-[11px] mt-1" style="color: var(--sys-label3)">
									{#if searchQuery}
										Tidak ada tiket yang cocok dengan pencarian "{searchQuery}".
									{:else}
										Belum ada tiket support yang dilaporkan.
									{/if}
								</p>
							</div>
						{:else}
							<div class="tickets-container">
								{#each filteredTickets as t (t.id)}
									{@const vBadge = verifikasiBadge(t.verifikasi_status)}
									{@const sBadge = statusBadge(t.status)}
									<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
									<div 
										class="ticket-card {expandedTicketId === t.id ? 'expanded' : ''} {focusedTicketIds.includes(String(t.id)) ? 'focused-card' : ''} {draggedTicketId === String(t.id) ? 'dragging' : ''} {dragOverTicketId === String(t.id) ? 'drag-over' : ''}"
										draggable="true"
										ondragstart={(e) => handleCardDragStart(e, t.id)}
										ondragover={(e) => handleCardDragOver(e, t.id)}
										ondragleave={(e) => handleCardDragLeave(e, t.id)}
										ondrop={(e) => handleCardDrop(e, t.id)}
										ondragend={handleCardDragEnd}
										onclick={() => toggleExpandTicket(t.id)}
										role="button"
										tabindex="0"
										onkeydown={(e) => {
											const target = e.target as HTMLElement | null;
											if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.tagName === 'BUTTON' || target.isContentEditable)) return;
											if (e.key === 'Enter' || e.key === ' ') toggleExpandTicket(t.id);
										}}
									>
									<div class="ticket-header-summary">
										<div class="ticket-meta">
											<div class="flex items-center gap-1.5">
												<span 
													class="drag-handle" 
													title="Geser untuk merubah urutan tiket"
													onclick={(e) => e.stopPropagation()}
												>
													<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
														<circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/>
														<circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>
													</svg>
												</span>
												<a 
													href="/support/{t.id}" 
													class="ticket-number hover:underline text-[var(--p,#1F6592)] font-bold"
													onclick={(e) => { e.stopPropagation(); show = false; }}
												>
													{t.nomor_tiket}
												</a>
											</div>
											<div class="flex items-center gap-2">
												<button 
													type="button" 
													class="btn-focus {focusedTicketIds.includes(String(t.id)) ? 'active' : ''}"
													onclick={(e) => { e.stopPropagation(); toggleFocusMode(t.id); }}
													title={focusedTicketIds.includes(String(t.id)) ? 'Nonaktifkan focus mode' : 'Aktifkan focus mode untuk prioritaskan task ini'}
												>
													🎯 Fokus
												</button>
												<span class="ticket-date inline-flex items-center gap-1">
													<IconClock size={10} /> {umurHari(t.date_created || t.tanggal)} hari lalu{#if formatSubmitTime(t.date_created || t.tanggal)} ({formatSubmitTime(t.date_created || t.tanggal)}){/if}
												</span>
											</div>
										</div>
										<h4 class="ticket-title">{t.judul}</h4>
										<div class="ticket-badges">
											<span class="badge" style="background: {vBadge.bg}; color: {vBadge.color}">
												{vBadge.label}
											</span>
											{#if t.verifikasi_status === 'Terverifikasi'}
												<span class="badge" style="background: {sBadge.bg}; color: {sBadge.color}">
													{t.status}
												</span>
											{/if}
											{#if t.prioritas}
												<span class="badge priority-{t.prioritas.toLowerCase()}">
													{t.prioritas}
												</span>
											{/if}
											{#if t.pelapor_nama}
												<span class="badge font-bold" style="background: #F3E8FF; color: #6B21A8;">
													Pengaju: {t.pelapor_nama}
												</span>
											{/if}
										</div>
									</div>

									{#if expandedTicketId === t.id}
										<div class="ticket-details-expanded" transition:fade={{ duration: 100 }}>
											<div class="detail-divider"></div>

											{#if editingTicketId === t.id}
												<!-- Form Edit Tiket -->
												<div class="p-3 bg-amber-50/70 border border-amber-200 rounded-xl my-2 flex flex-col gap-3" onclick={(e) => e.stopPropagation()}>
													<div class="flex items-center justify-between border-b border-amber-200/80 pb-2">
														<span class="text-xs font-bold text-amber-900 flex items-center gap-1.5">
															<span>✏️</span> Edit Detail / Isi Tiket
														</span>
														<button
															type="button"
															class="text-amber-700 hover:text-amber-900 text-xs font-bold px-2 py-0.5 rounded hover:bg-amber-100/60 transition-colors"
															onclick={cancelEditTicket}
														>
															✕ Batal
														</button>
													</div>

													<!-- Judul -->
													<div class="flex flex-col text-left">
														<label class="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Judul Masalah <span class="text-red-500">*</span></label>
														<input
															type="text"
															class="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold focus:outline-none focus:ring-2 focus:ring-amber-500/20"
															bind:value={editSubject}
														/>
													</div>

													<!-- Departemen & Prioritas -->
													<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
														<div class="flex flex-col text-left">
															<label class="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Departemen Tujuan <span class="text-red-500">*</span></label>
															<select
																class="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500/20"
																bind:value={editTargetDept}
															>
																{#each DEPARTEMEN as d}
																	<option value={d}>{d === 'IT' ? '💻 Tim IT' : d}</option>
																{/each}
															</select>
														</div>

														<div class="flex flex-col text-left">
															<label class="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Prioritas</label>
															<select
																class="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500/20"
																bind:value={editPriority}
															>
																{#each PRIORITAS as p}
																	<option value={p}>{p}</option>
																{/each}
															</select>
														</div>
													</div>

													<!-- Kategori / Fitur -->
													<div class="flex flex-col text-left">
														<label class="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Kategori / Fitur Yang Diperbaiki</label>
														<input
															type="text"
															placeholder="Contoh: Printer, SAP, Menu Fleet, Absensi"
															class="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium focus:outline-none focus:ring-2 focus:ring-amber-500/20"
															bind:value={editCategory}
														/>
													</div>

													<!-- Deskripsi Masalah -->
													<div class="flex flex-col text-left">
														<label class="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Deskripsi Detail Masalah <span class="text-red-500">*</span></label>
														<textarea
															rows={3}
															class="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium focus:outline-none focus:ring-2 focus:ring-amber-500/20 resize-y"
															bind:value={editDescription}
														></textarea>
													</div>

													<!-- Lampiran -->
													<div class="flex flex-col text-left">
														<label class="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Lampiran / Screenshot Bukti</label>
														{#if editPreviewUrl || editAttachment}
															<div class="p-2 bg-white border border-slate-200 rounded-lg flex items-center justify-between gap-2">
																<div class="flex items-center gap-2 min-w-0">
																	{#if editPreviewUrl}
																		<img src={editPreviewUrl} alt="Preview file baru" class="w-10 h-10 object-cover rounded border border-slate-200" />
																		<div class="min-w-0">
																			<p class="text-[11px] font-bold text-slate-700 truncate">{editNewFile?.name || 'attachment.file'}</p>
																			<p class="text-[9px] text-slate-400 font-medium">{((editNewFile?.size || 0) / 1024).toFixed(1)} KB (File Baru)</p>
																		</div>
																	{:else if editAttachment}
																		<img src="{DIRECTUS_URL}/assets/{editAttachment}" alt="Preview attachment" class="w-10 h-10 object-cover rounded border border-slate-200" />
																		<div class="min-w-0">
																			<p class="text-[11px] font-bold text-slate-700 truncate">{editAttachment}</p>
																			<p class="text-[9px] text-slate-400 font-medium">Lampiran Saat Ini</p>
																		</div>
																	{/if}
																</div>
																<button
																	type="button"
																	class="px-2 py-1 bg-red-50 hover:bg-red-100 text-red-650 text-[10px] font-bold border border-red-150 rounded transition-colors"
																	onclick={removeEditTicketFile}
																>
																	Hapus File
																</button>
															</div>
														{:else}
															<label class="cursor-pointer text-[11px] text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-1.5 p-2 bg-white border border-dashed border-indigo-300 rounded-lg justify-center hover:bg-indigo-50/50 transition-colors">
																📎 <span>Pilih File Lampiran Baru</span>
																<input
																	type="file"
																	accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip"
																	class="hidden"
																	onchange={handleEditTicketFileChange}
																/>
															</label>
														{/if}
													</div>

													<!-- Tombol Simpan / Batal -->
													<div class="flex justify-end gap-2 mt-1 pt-2 border-t border-amber-200/80">
														<button
															type="button"
															class="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-700 font-bold text-xs hover:bg-slate-100 transition-colors"
															onclick={cancelEditTicket}
														>
															Batal
														</button>
														<button
															type="button"
															class="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 border border-amber-700 text-white rounded-lg font-bold text-xs transition-all shadow-sm flex items-center gap-1 disabled:opacity-60"
															onclick={() => saveTicketEdit(t.id)}
															disabled={savingTicketEdit}
														>
															{#if savingTicketEdit}
																<span>Menyimpan...</span>
															{:else}
																<span>💾 Simpan Perubahan</span>
															{/if}
														</button>
													</div>
												</div>
											{:else}
												<!-- Action Row for Edit Tiket -->
												<div class="flex justify-between items-center mb-2" onclick={(e) => e.stopPropagation()}>
													<span class="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Detail Informasi Tiket</span>
													<button
														type="button"
														class="px-2.5 py-1 text-xs font-bold text-amber-700 hover:text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-all flex items-center gap-1"
														onclick={() => startEditTicket(t)}
													>
														✏️ Edit Isi Tiket
													</button>
												</div>

												<div class="detail-row">
													<span class="detail-label">Diajukan Oleh:</span>
													<span class="detail-val">{t.pelapor_nama || t.pelapor_id || '-'}</span>
												</div>

												<div class="detail-row">
													<span class="detail-label">Waktu Submit:</span>
													<span class="detail-val">{formatLogDate(t.tanggal)}</span>
												</div>

												<div class="detail-row">
													<span class="detail-label">Departemen Tujuan:</span>
													<span class="detail-val">{t.departemen_tujuan || '-'}</span>
												</div>
												
												{#if t.kategori}
													<div class="detail-row">
														<span class="detail-label">Kategori / Fitur:</span>
														<span class="detail-val">{t.kategori}</span>
													</div>
												{/if}

												<div class="detail-row flex-col">
													<span class="detail-label mb-1">Deskripsi Masalah:</span>
													<p class="detail-text-block">{t.deskripsi}</p>
												</div>

												{#if t.solusi}
													<div class="detail-row flex-col mt-2">
														<span class="detail-label mb-1 text-green-700 font-bold">Solusi / Balasan:</span>
														<p class="detail-text-block bg-green-50 border-green-200 text-green-800">{t.solusi}</p>
													</div>
												{/if}

												{#if t.lampiran}
													{@const attIds = parseLampiranIds(t.lampiran)}
													{#if attIds.length > 0}
														<!-- svelte-ignore a11y_click_events_have_key_events -->
														<!-- svelte-ignore a11y_no_static_element_interactions -->
														<div class="detail-row flex-col mt-2 text-left" onclick={(e) => e.stopPropagation()}>
															<span class="detail-label mb-1">Lampiran Bukti ({attIds.length}):</span>
															<div class="flex flex-wrap gap-2 mt-1">
																{#each attIds as attId}
																	<div class="relative group rounded-lg overflow-hidden border border-slate-200 bg-slate-50 cursor-pointer hover:shadow-md transition-all">
																		<img 
																			src="{DIRECTUS_URL}/assets/{attId}?width=300&quality=80" 
																			alt="Lampiran {t.nomor_tiket}" 
																			class="w-24 h-24 object-cover hover:scale-105 transition-transform" 
																			onclick={() => window.open(`${DIRECTUS_URL}/assets/${attId}`, '_blank')}
																		/>
																		<a 
																			href="{DIRECTUS_URL}/assets/{attId}" 
																			target="_blank" 
																			class="absolute bottom-0 inset-x-0 bg-slate-900/80 text-white text-[9px] py-0.5 text-center opacity-0 group-hover:opacity-100 transition-opacity"
																			onclick={(e) => e.stopPropagation()}
																		>
																			Buka ↗
																		</a>
																	</div>
																{/each}
															</div>
														</div>
													{/if}
												{/if}
											{/if}

											<div class="detail-row flex-col mt-2">
												<div class="flex items-center justify-between mb-1.5 flex-wrap gap-1">
													<span class="detail-label">Riwayat Progress:</span>
													{#if ticketLogs[t.id] && ticketLogs[t.id].length > 0}
														{@const stats = getChecklistStats(ticketLogs[t.id])}
														{#if stats.total > 0}
															<span class="text-[9px] font-bold px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-700 flex items-center gap-1">
																<span class="w-1.5 h-1.5 rounded-full {stats.percent === 100 ? 'bg-emerald-500' : 'bg-amber-500'}"></span>
																<span>{stats.completed}/{stats.total} Checklist ({stats.percent}%)</span>
															</span>
														{/if}
													{/if}
												</div>

												{#if ticketLogs[t.id] && ticketLogs[t.id].length > 0}
													{@const stats = getChecklistStats(ticketLogs[t.id])}
													{#if stats.total > 0}
														<div class="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden mb-2">
															<div class="bg-emerald-500 h-full transition-all duration-300" style="width: {stats.percent}%;"></div>
														</div>
													{/if}
												{/if}

												{#if loadingLogs[t.id]}
													<p class="text-[11px] text-gray-400">Memuat riwayat…</p>
												{:else if !ticketLogs[t.id] || ticketLogs[t.id].length === 0}
													<p class="text-[11px] text-gray-400">Belum ada riwayat update progress.</p>
												{:else}
													<ol class="space-y-1.5 max-h-40 overflow-y-auto pr-1">
														{#each ticketLogs[t.id] as l (l.id)}
															<li class="flex gap-2 text-[11px] border rounded-lg p-2 transition-all {l.is_completed ? 'bg-emerald-50/60 border-emerald-200/80' : 'bg-slate-50 border-slate-100'}">
																<button
																	type="button"
																	class="mt-0.5 shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors cursor-pointer text-[10px] font-bold {l.is_completed ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-slate-300 hover:border-indigo-400 text-transparent'}"
																	onclick={() => toggleLogCompleted(l, t.id)}
																	title={l.is_completed ? 'Tandai belum selesai' : 'Tandai selesai'}
																>
																	✓
																</button>
																<div class="flex-1 min-w-0">
																	<div class="flex items-center justify-between gap-1.5 flex-wrap">
																		<div class="flex items-center gap-1.5 flex-wrap">
																			<span class="font-bold text-slate-800">{l.tipe === 'Delegasi' ? 'Delegasi' : l.tipe === 'Status' ? 'Status' : 'Progress'}</span>
																			<span class="text-slate-400 text-[10px]">{formatLogDate(l.date_created)}</span>
																			{#if l.oleh}<span class="text-slate-400 text-[10px]">oleh {l.oleh}</span>{/if}
																			{#if l.is_completed}
																				<span class="text-[8px] font-bold px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">Selesai ✓</span>
																			{/if}
																		</div>
																		{#if editingLogId !== l.id}
																			<div class="flex items-center gap-1">
																				<button
																					type="button"
																					class="px-1.5 py-0.5 text-[9px] font-bold text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-200 rounded transition-colors"
																					onclick={() => startEditLog(l)}
																					title="Edit Progress"
																				>
																					✏️ Edit
																				</button>
																				<button
																					type="button"
																					class="px-1.5 py-0.5 text-[9px] font-bold text-slate-400 hover:text-red-600 hover:bg-red-50 border border-slate-200 hover:border-red-200 rounded transition-colors"
																					onclick={() => confirmDeleteLog(l, t.id)}
																					title="Hapus Progress"
																				>
																					🗑️
																				</button>
																			</div>
																		{/if}
																	</div>

																	{#if editingLogId === l.id}
																		<div class="mt-2 p-2 bg-white border border-indigo-200 rounded-lg flex flex-col gap-2 shadow-sm">
																			<textarea
																				rows="2"
																				class="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded text-[10px] font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500"
																				bind:value={editingLogCatatan}
																				placeholder="Edit catatan progress..."
																			></textarea>
																			
																			<label class="inline-flex items-center gap-1.5 text-[10px] font-semibold text-slate-700 cursor-pointer select-none">
																				<input
																					type="checkbox"
																					class="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
																					bind:checked={editingLogCompleted}
																				/>
																				<span>Selesai / Checked</span>
																			</label>

																			{#if editingLogNewFile || editingLogAttachment}
																				<div class="p-1.5 bg-slate-50 border border-slate-200 rounded flex items-center justify-between gap-2">
																					<span class="text-[9px] text-slate-600 truncate">
																						📎 {editingLogNewFile ? editingLogNewFile.name : 'Attachment'}
																					</span>
																					<button
																						type="button"
																						class="text-[9px] text-red-600 hover:underline font-bold"
																						onclick={removeEditFile}
																					>
																						Hapus File
																					</button>
																				</div>
																			{/if}

																			<div class="flex items-center justify-between gap-2 mt-1">
																				<label class="cursor-pointer text-[9px] text-indigo-650 hover:underline font-bold flex items-center gap-1">
																					📎 <span>{editingLogAttachment || editingLogNewFile ? 'Ganti File' : 'Tambah File'}</span>
																					<input
																						type="file"
																						accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip"
																						class="hidden"
																						onchange={handleEditFileChange}
																					/>
																				</label>
																				<div class="flex items-center gap-1">
																					<button
																						type="button"
																						class="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[9px] font-bold border border-slate-200 rounded transition-colors"
																						onclick={cancelEditLog}
																					>
																						Batal
																					</button>
																					<button
																						type="button"
																						class="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-[9px] font-bold border border-indigo-700 rounded transition-colors shadow-sm disabled:opacity-60 flex items-center gap-1"
																						onclick={() => saveEditLog(l, t.id)}
																						disabled={savingEditLog}
																					>
																						{#if savingEditLog}
																							<span>Menyimpan...</span>
																						{:else}
																							<span>Simpan</span>
																						{/if}
																					</button>
																				</div>
																			</div>
																		</div>
																	{:else}
																		{#if l.tipe === 'Delegasi'}
																			<div class="text-slate-500 font-medium">
																				{#if l.pic_ke}PIC: {l.pic_dari || '-'} → <strong>{l.pic_ke}</strong>{/if}
																				{#if l.departemen_ke}{l.pic_ke ? ' · ' : ''}Dept: {l.departemen_dari || '-'} → <strong>{l.departemen_ke}</strong>{/if}
																			</div>
																		{:else if l.status_ke}
																			<div class="text-slate-500 font-medium">Status: {l.status_dari || '-'} → <strong>{l.status_ke}</strong></div>
																		{/if}
																		{#if l.catatan}
																			<div class="text-slate-650 whitespace-pre-wrap mt-0.5 transition-all {l.is_completed ? 'line-through opacity-75 text-slate-500' : ''}">{l.catatan}</div>
																		{/if}
																		{#if l.lampiran}
																			<div class="mt-1 max-w-full rounded-lg overflow-hidden border border-slate-200 bg-slate-50 cursor-pointer hover:opacity-95 transition-opacity" style="max-height: 120px; display: inline-block;">
																				<img 
																					src="{DIRECTUS_URL}/assets/{l.lampiran}" 
																					alt="Lampiran Progress" 
																					class="object-contain" 
																					style="max-height: 120px; max-width: 100%; display: block;"
																					onclick={() => window.open(`${DIRECTUS_URL}/assets/${l.lampiran}`, '_blank')}
																				/>
																			</div>
																		{/if}
																	{/if}
																</div>
															</li>
														{/each}
													</ol>
												{/if}
											</div>

											<div class="detail-row flex-col mt-2">
												<span class="detail-label mb-1">Halaman Support:</span>
												<a 
													href="/support/{t.id}" 
													class="detail-link font-semibold flex items-center gap-1 text-[12px]"
													onclick={(e) => { e.stopPropagation(); show = false; }}
												>
													Buka Detail di Halaman Support <IconChevronRight size={14} />
												</a>
											</div>
										</div>
									{/if}
								</div>
							{/each}

							<div class="mt-4 pt-2 border-t border-[var(--sys-sep)] text-center">
								<a 
									href="/support" 
									class="detail-link font-bold text-[12px] inline-flex items-center gap-1"
									onclick={() => show = false}
								>
									Buka Semua Tiket di Halaman Support <IconChevronRight size={14} />
								</a>
							</div>
						</div>
					{/if}
				{/if}
			{/if}
			</div>

			<!-- Footer -->
			<div class="quick-support-footer">
				{#if activeTab === 'create'}
					<button
						type="button"
						class="btn-cancel"
						onclick={() => (show = false)}
						disabled={loading}
					>
						Batal
					</button>
					<button
						type="button"
						class="btn-submit"
						onclick={handleSubmit}
						disabled={loading}
					>
						{#if loading}
							<IconLoader2 size={14} class="animate-spin mr-1.5 inline" />
							<span>{uploadingFile ? 'Mengunggah...' : 'Mengirim...'}</span>
						{:else}
							<span>Kirim Tiket</span>
						{/if}
					</button>
				{:else}
					<button
						type="button"
						class="btn-cancel"
						onclick={() => (show = false)}
					>
						Tutup
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.quick-support-overlay {
		position: fixed;
		inset: 0;
		background: rgba(15, 23, 42, 0.5);
		backdrop-filter: blur(4px);
		-webkit-backdrop-filter: blur(4px);
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
	}
	.quick-support-panel {
		width: 100%;
		max-width: 54rem;
		background: var(--sys-bg2, #ffffff);
		border: 1px solid var(--sys-sep, #e2e8f0);
		border-radius: 1rem;
		box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1);
		display: flex;
		flex-direction: column;
		max-height: 90vh;
		overflow: hidden;
		animation: scaleUp 0.18s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
	}
	@keyframes scaleUp {
		from { transform: scale(0.95); opacity: 0; }
		to { transform: scale(1); opacity: 1; }
	}
	.quick-support-header {
		display: flex;
		align-items: center;
		justify-content: justify;
		justify-content: space-between;
		padding: 1rem 1.5rem;
		background: var(--sys-fill, #f8fafc);
		border-bottom: 1px solid var(--sys-sep, #e2e8f0);
	}
	.panel-title {
		font-size: 0.875rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--sys-label, #1e293b);
	}
	.panel-subtitle {
		font-size: 0.625rem;
		font-weight: 500;
		color: var(--sys-label3, #64748b);
		margin-top: 0.125rem;
	}
	.btn-close {
		color: var(--sys-label3, #94a3b8);
		border-radius: 9999px;
		width: 2rem;
		height: 2rem;
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		cursor: pointer;
		transition: all 0.15s;
	}
	.btn-close:hover {
		background: var(--sys-fill2, #e2e8f0);
		color: var(--sys-label, #1e293b);
	}
	.quick-support-body {
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		overflow-y: auto;
		flex: 1;
	}
	.grid-2 {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1rem;
	}
	@media (min-width: 768px) {
		.grid-2 {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	.grid-3 {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1rem;
	}
	@media (min-width: 768px) {
		.grid-3 {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
		.col-span-2 {
			grid-column: span 2 / span 2;
		}
	}
	.form-group {
		display: flex;
		flex-direction: column;
	}
	.form-label {
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--sys-label3, #64748b);
		margin-bottom: 0.25rem;
	}
	.required {
		color: #ef4444;
	}
	.form-input {
		width: 100%;
		padding: 0.5rem 0.75rem;
		background: var(--sys-bg, #ffffff);
		border: 1px solid var(--sys-sep2, #cbd5e1);
		border-radius: 0.75rem;
		font-size: 0.75rem;
		color: var(--sys-label, #1e293b);
		outline: none;
		transition: all 0.15s;
	}
	.form-input:focus {
		border-color: var(--p, #1f6592);
		box-shadow: 0 0 0 2px rgba(31, 101, 146, 0.15);
	}
	.form-textarea {
		width: 100%;
		padding: 0.625rem 0.75rem;
		background: var(--sys-bg, #ffffff);
		border: 1px solid var(--sys-sep2, #cbd5e1);
		border-radius: 0.75rem;
		font-size: 0.75rem;
		color: var(--sys-label, #1e293b);
		outline: none;
		resize: none;
		font-family: inherit;
		transition: all 0.15s;
	}
	.form-textarea:focus {
		border-color: var(--p, #1f6592);
		box-shadow: 0 0 0 2px rgba(31, 101, 146, 0.15);
	}
	.preview-box {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.75rem;
		background: var(--sys-fill, #f8fafc);
		border: 1px solid var(--sys-sep, #e2e8f0);
		border-radius: 0.75rem;
	}
	.preview-info {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		min-width: 0;
	}
	.preview-img {
		width: 3.5rem;
		height: 3.5rem;
		object-fit: cover;
		border-radius: 0.5rem;
		border: 1px solid var(--sys-sep, #e2e8f0);
	}
	.preview-text {
		min-width: 0;
	}
	.file-name {
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--sys-label, #1e293b);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.file-size {
		font-size: 0.625rem;
		color: var(--sys-label3, #64748b);
		margin-top: 0.125rem;
	}
	.btn-remove {
		padding: 0.375rem 0.625rem;
		background: #fef2f2;
		color: #dc2626;
		font-size: 0.625rem;
		font-weight: 700;
		border: 1px solid #fee2e2;
		border-radius: 0.5rem;
		cursor: pointer;
		transition: all 0.15s;
	}
	.btn-remove:hover {
		background: #fee2e2;
	}
	.upload-dropzone {
		border: 2px dashed var(--sys-sep2, #cbd5e1);
		border-radius: 0.75rem;
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		background: var(--sys-fill, #f8fafc);
		cursor: pointer;
		transition: all 0.15s;
	}
	.upload-dropzone:hover,
	.upload-dropzone.active {
		border-color: var(--p, #1f6592);
		background: rgba(31, 101, 146, 0.03);
	}
	.dropzone-text {
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--sys-label2, #475569);
	}
	.dropzone-tip {
		font-size: 0.625rem;
		color: var(--sys-label3, #94a3b8);
	}
	kbd {
		background: var(--sys-fill2, #e2e8f0);
		border-radius: 0.25rem;
		padding: 0.0625rem 0.25rem;
		font-size: 0.55rem;
		font-family: monospace;
	}
	.hidden-input {
		display: none;
	}
	.quick-support-footer {
		padding: 1rem 1.5rem;
		background: var(--sys-fill, #f8fafc);
		border-top: 1px solid var(--sys-sep, #e2e8f0);
		display: flex;
		justify-content: flex-end;
		gap: 0.75rem;
	}
	.btn-cancel {
		padding: 0.5rem 1rem;
		background: var(--sys-bg, #ffffff);
		border: 1px solid var(--sys-sep2, #cbd5e1);
		border-radius: 0.75rem;
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--sys-label2, #475569);
		cursor: pointer;
		transition: all 0.15s;
	}
	.btn-cancel:hover {
		background: var(--sys-fill, #f8fafc);
	}
	.btn-submit {
		padding: 0.5rem 1.25rem;
		background: var(--p, #1f6592);
		color: #ffffff;
		border: none;
		border-radius: 0.75rem;
		font-size: 0.75rem;
		font-weight: 700;
		cursor: pointer;
		box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
		transition: all 0.15s;
		display: flex;
		align-items: center;
	}
	.btn-submit:hover {
		opacity: 0.95;
		box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
	}
	.btn-submit:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	/* Tabs Styling */
	.quick-support-tabs {
		display: flex;
		border-bottom: 1px solid var(--sys-sep, #e2e8f0);
		background: var(--sys-bg, #ffffff);
	}
	.support-tab {
		flex: 1;
		padding: 0.75rem 1rem;
		font-size: 0.8125rem;
		font-weight: 700;
		color: var(--sys-label3, #64748b);
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		cursor: pointer;
		transition: all 0.15s;
		text-align: center;
	}
	.support-tab:hover {
		color: var(--sys-label, #1e293b);
		background: var(--sys-fill, #f8fafc);
	}
	.support-tab.active {
		color: var(--p, #1f6592);
		border-bottom-color: var(--p, #1f6592);
	}

	/* Ticket list styling */
	.tickets-container {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.ticket-card {
		padding: 1rem;
		background: var(--sys-bg, #ffffff);
		border: 1px solid var(--sys-sep, #e2e8f0);
		border-radius: 0.75rem;
		cursor: pointer;
		transition: all 0.15s ease;
		text-align: left;
	}
	.ticket-card:hover {
		border-color: var(--p, #1f6592);
		box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.05);
	}
	.ticket-card.expanded {
		border-color: var(--p, #1f6592);
		box-shadow: 0 2px 8px rgba(31, 101, 146, 0.08);
	}
	.ticket-header-summary {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}
	.ticket-meta {
		display: flex;
		justify-content: space-between;
		font-size: 0.6875rem;
		font-weight: 600;
		color: var(--sys-label4, #94a3b8);
	}
	.ticket-title {
		font-size: 0.8125rem;
		font-weight: 700;
		color: var(--sys-label, #1e293b);
		margin: 0;
	}
	.ticket-badges {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		margin-top: 0.25rem;
	}
	.badge {
		font-size: 0.625rem;
		font-weight: 700;
		padding: 0.125rem 0.5rem;
		border-radius: 9999px;
	}
	.priority-rendah {
		background: var(--sys-fill, #f1f5f9);
		color: var(--sys-label2, #475569);
	}
	.priority-sedang {
		background: rgba(232, 178, 61, 0.16);
		color: var(--color-warning-text, #d97706);
	}
	.priority-tinggi {
		background: rgba(240, 99, 108, 0.14);
		color: var(--color-error-text, #e11d48);
	}
	.priority-urgent {
		background: rgba(240, 99, 108, 0.22);
		color: var(--color-error-text, #dc2626);
		animation: pulse-priority 2s infinite;
	}
	@keyframes pulse-priority {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.7; }
	}
	.ticket-details-expanded {
		margin-top: 0.75rem;
	}
	.detail-divider {
		height: 1px;
		background: var(--sys-sep, #e2e8f0);
		margin-bottom: 0.75rem;
	}
	.detail-row {
		display: flex;
		justify-content: space-between;
		font-size: 0.75rem;
		margin-bottom: 0.5rem;
		gap: 0.5rem;
	}
	.flex-col {
		flex-direction: column;
	}
	.detail-label {
		font-weight: 600;
		color: var(--sys-label3, #64748b);
	}
	.detail-val {
		color: var(--sys-label, #1e293b);
		font-weight: 500;
	}
	.detail-text-block {
		padding: 0.625rem;
		background: var(--sys-fill, #f8fafc);
		border: 1px solid var(--sys-sep, #e2e8f0);
		border-radius: 0.5rem;
		font-size: 0.75rem;
		color: var(--sys-label2, #475569);
		margin: 0;
		white-space: pre-wrap;
	}
	.detail-link {
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--p, #1f6592);
		text-decoration: underline;
		cursor: pointer;
	}

	/* Search bar styling */
	.search-wrapper {
		position: relative;
		display: flex;
		align-items: center;
		margin-bottom: 0.875rem;
	}
	.search-icon {
		position: absolute;
		left: 0.75rem;
		color: var(--sys-label3, #94a3b8);
		pointer-events: none;
	}
	.search-input {
		width: 100%;
		padding: 0.5rem 2rem 0.5rem 2.25rem;
		background: var(--sys-fill, #f8fafc);
		border: 1px solid var(--sys-sep, #e2e8f0);
		border-radius: 0.75rem;
		font-size: 0.75rem;
		color: var(--sys-label, #1e293b);
		outline: none;
		transition: all 0.15s;
	}
	.search-input:focus {
		background: var(--sys-bg, #ffffff);
		border-color: var(--p, #1f6592);
		box-shadow: 0 0 0 2px rgba(31, 101, 146, 0.15);
	}
	.btn-clear-search {
		position: absolute;
		right: 0.75rem;
		color: var(--sys-label3, #94a3b8);
		background: transparent;
		border: none;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.125rem;
		border-radius: 9999px;
		transition: all 0.15s;
	}
	.btn-clear-search:hover {
		background: var(--sys-fill2, #e2e8f0);
		color: var(--sys-label, #1e293b);
	}

	/* Focus mode styles */
	.ticket-card.focused-card {
		border-color: #f59e0b !important;
		background: linear-gradient(to right, #fffbeb, var(--sys-bg2, #ffffff)) !important;
		box-shadow: 0 4px 12px rgba(245, 158, 11, 0.08) !important;
		position: relative;
	}
	:global(:root[data-theme='dark']) .ticket-card.focused-card {
		background: linear-gradient(to right, rgba(245, 158, 11, 0.15), var(--sys-bg2, #1B2530)) !important;
	}
	.ticket-card.focused-card::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: 4px;
		background: #f59e0b;
		border-radius: 1rem 0 0 1rem;
	}
	.btn-focus {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.125rem 0.375rem;
		font-size: 0.625rem;
		font-weight: 700;
		border-radius: 0.375rem;
		transition: all 0.15s ease;
		cursor: pointer;
		background: transparent;
		border: 1px solid var(--sys-sep, #e2e8f0);
		color: var(--sys-label3, #64748b);
	}
	.btn-focus:hover {
		background: var(--sys-fill, #f8fafc);
		border-color: #f59e0b;
		color: #b45309;
	}
	.btn-focus.active {
		background: #fef3c7;
		border-color: #f59e0b;
		color: #b45309;
		animation: pulse-focus 2s infinite;
	}
	@keyframes pulse-focus {
		0%, 100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.4); }
		50% { box-shadow: 0 0 0 4px rgba(245, 158, 11, 0); }
	}

	/* Drag & Drop Reordering Styles */
	.ticket-card.dragging {
		opacity: 0.45;
		transform: scale(0.98);
		border-style: dashed !important;
		border-color: #6366f1 !important;
	}
	.ticket-card.drag-over {
		border-color: #4f46e5 !important;
		box-shadow: 0 0 0 2px rgba(79, 70, 229, 0.35), 0 8px 16px rgba(79, 70, 229, 0.1) !important;
		transform: translateY(-2px);
		background-color: rgba(99, 102, 241, 0.04) !important;
	}
	.drag-handle {
		cursor: grab;
		user-select: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 2px 4px;
		border-radius: 4px;
		color: #94a3b8;
		transition: color 0.15s, background-color 0.15s;
	}
	.drag-handle:hover {
		color: #4f46e5;
		background: #eef2ff;
	}
	.drag-handle:active {
		cursor: grabbing;
	}
</style>
