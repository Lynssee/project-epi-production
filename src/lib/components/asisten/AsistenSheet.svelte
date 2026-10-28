<!-- AsistenSheet.svelte — Asisten AI dashboard lapangan (lembar-bawah, mobile-first).
     Fase 1 — Rencana Implementasi Asisten Eltama v2.0 §14/§15/§19.2: "tombol dulu,
     percakapan belakangan" — aksi cepat tampil sebelum kotak ketik, karena pengguna
     lapangan sering memakai aplikasi sambil berdiri/bekerja.
     Terhubung ke /api/ai-assistant (gateway sendiri, TypeScript) — respons JSON
     tunggal non-streaming, sama seperti ChatbotBubble.svelte di erp-epi-1.
     Fase 2 (§8): draf requisition — kartu konfirmasi "Buat Draf/Batal" muncul
     saat gateway mengembalikan field `draft`; penulisan nyata hanya terjadi
     setelah tombol ditekan, lewat /api/ai-assistant/draft-requisition.
     BELUM: input suara, draf work order/tiket, lampiran foto (Fase 1/2 lanjutan). -->
<script lang="ts">
	import { auth } from '$lib/firebase';
	import { asistenOpen, asistenPrefill } from '$lib/stores/asistenStore';
	import { page } from '$app/state';
	import { listConversations, getConversationMessages, sendChatFeedback, type ThreadSummary } from '$lib/services/aiConversationsApi';
	import { fetchSuggestionsForPage } from '$lib/services/aiContextTemplatesApi';
	import { secureDirectusFetch } from '$lib/services/secureDirectus';
	import { getEquipmentByCode } from '$lib/services/preventive';
	import {
		enqueueAsistenDraft,
		getQueuedAsistenDrafts,
		flushAsistenDraftQueue,
		registerAsistenDraftAutoFlush
	} from '$lib/utils/offlineAsistenDraftQueue';

	interface RequisitionDraft {
		type: 'requisition';
		requisitionType: string;
		items: Array<{ identitas_barang_id: number; nama_barang: string; quantity_requested: number; units: string | null }>;
		tujuanPenggunaan: string;
	}

	// 5B#1 — draf tiket maintenance dari foto kerusakan (menumpang Fase 1 Attachment).
	interface MaintenanceTicketDraft {
		type: 'maintenance_ticket';
		equipmentId: string;
		equipmentName: string;
		keluhan: string;
		urgency: 'minor' | 'darurat';
		/** Foto yang dilampirkan pada giliran yang sama (klien-only, tidak dikirim server di respons draft — dijahit balik dari pendingFiles saat draf diterima). */
		photo?: { name: string; mime: string; base64: string; previewUrl: string };
	}

	type AnyDraft = RequisitionDraft | MaintenanceTicketDraft;

	interface AttachmentMeta {
		name: string;
		mime: string;
		kind: 'image' | 'pdf' | 'text';
		size: number;
		fileId?: string | null;
		previewUrl?: string;
	}

	interface ChatMessage {
		role: 'user' | 'assistant';
		content: string;
		tool?: string;
		toolsUsed?: string[];
		draft?: AnyDraft;
		draftStatus?: 'pending' | 'confirmed' | 'cancelled' | 'error' | 'queued';
		draftResultText?: string;
		sourceQuestion?: string;
		chatLogId?: number;
		feedback?: 'up' | 'down' | null;
		attachments?: AttachmentMeta[];
		suggestions?: string[];
		copied?: boolean;
	}

	let open = $state(false);
	asistenOpen.subscribe((v) => (open = v));

	let input = $state('');
	asistenPrefill.subscribe((v) => {
		if (v) {
			input = v;
			asistenPrefill.set('');
		}
	});

	let streaming = $state(false);
	// §5A Streaming — null = belum dicoba, true/false = dipelajari dari percobaan
	// pertama (via header respons, bukan diasumsikan) supaya tidak mencoba ulang
	// endpoint SSE tiap pesan kalau server memang mematikannya.
	let streamingSupported: boolean | null = null;
	let messages = $state<ChatMessage[]>([]);
	let scrollEl: HTMLDivElement | undefined = $state();
	let buttonEl: HTMLButtonElement | undefined = $state();

	// Variabel untuk drag-and-drop
	let isDragging = false;
	let dragFlag = false;
	let startX = 0;
	let startY = 0;
	let initialLeft = 0;
	let initialTop = 0;

	const sessionId =
		typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

	// Fase 4 — Persistence Riwayat: threadId null = percakapan baru.
	let threadId = $state<number | null>(null);

	// Fase 3 (fullscreen ringan, implementation_plan_asisten_ai_v2.md §3) — persist
	// preferensi layar penuh lintas sesi, plus Esc untuk tutup dan Alt+Shift+A untuk
	// buka/tutup. Sidebar riwayat split-pane SENGAJA dilewati (keputusan user).
	const FULLSCREEN_STORAGE_KEY = 'asistenFullscreen';
	let isFullscreen = $state(typeof localStorage !== 'undefined' ? localStorage.getItem(FULLSCREEN_STORAGE_KEY) === '1' : false);
	function toggleFullscreen() {
		isFullscreen = !isFullscreen;
		if (typeof localStorage !== 'undefined') localStorage.setItem(FULLSCREEN_STORAGE_KEY, isFullscreen ? '1' : '0');
	}

	// Ctrl+Shift+A bentrok dengan shortcut browser bawaan (Firefox: Add-ons manager,
	// Chrome: Search tabs) — dipakai Alt+Shift+A sebagai gantinya.
	function onGlobalKey(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) {
			e.preventDefault();
			asistenOpen.set(false);
			return;
		}
		if (e.altKey && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
			e.preventDefault();
			toggle();
		}
	}

	let showHistory = $state(false);
	let historyLoading = $state(false);
	let historyList = $state<ThreadSummary[]>([]);

	// Fase 1 Attachment — implementation_plan_asisten_ai_v2.md §1.4: lampiran
	// (foto/PDF/teks) hanya berlaku untuk pesan yang sedang diketik (pendingFiles),
	// tidak dipersist balik ke riwayat lokal — server hanya simpan metadata.
	// Prioritas tinggi lapangan (§5B#1 foto→draf laporan menumpang di sini).
	const ATTACHMENT_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,.pdf,.csv,.txt';
	const MAX_ATTACHMENTS = 3;
	const MAX_ATTACHMENT_MB = 6;
	const IMAGE_MAX_DIMENSION = 1568;
	interface PendingFile {
		name: string;
		mime: string;
		base64: string;
		previewUrl: string;
		kind: 'image' | 'pdf' | 'text';
		size: number;
	}
	let pendingFiles = $state<PendingFile[]>([]);
	let attachError = $state('');
	let fileInputEl: HTMLInputElement | undefined = $state();
	let textareaEl: HTMLTextAreaElement | undefined = $state();
	let isFileDragOver = $state(false);

	$effect(() => {
		if (open && textareaEl) {
			queueMicrotask(() => textareaEl?.focus());
		}
	});

	function autoResizeTextarea(e: Event) {
		const el = (e.target || textareaEl) as HTMLTextAreaElement;
		if (el) {
			el.style.height = 'auto';
			el.style.height = Math.min(el.scrollHeight, 120) + 'px';
		}
	}

	function fileKind(mime: string, name: string): 'image' | 'pdf' | 'text' {
		if (/^image\//.test(mime)) return 'image';
		if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
		return 'text';
	}

	function readFileAsDataUrl(file: File): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result));
			reader.onerror = () => reject(reader.error || new Error('Gagal membaca file'));
			reader.readAsDataURL(file);
		});
	}

	async function compressImage(dataUrl: string, mime: string): Promise<string> {
		const img = new Image();
		await new Promise<void>((resolve, reject) => {
			img.onload = () => resolve();
			img.onerror = () => reject(new Error('Gagal memuat gambar'));
			img.src = dataUrl;
		});
		const scale = Math.min(1, IMAGE_MAX_DIMENSION / Math.max(img.width, img.height));
		const w = Math.max(1, Math.round(img.width * scale));
		const h = Math.max(1, Math.round(img.height * scale));
		const canvas = document.createElement('canvas');
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext('2d');
		ctx?.drawImage(img, 0, 0, w, h);
		const outMime = mime === 'image/gif' ? 'image/png' : mime;
		return canvas.toDataURL(outMime, 0.85);
	}

	async function processFileList(files: File[]) {
		attachError = '';
		if (!files.length) return;

		if (pendingFiles.length + files.length > MAX_ATTACHMENTS) {
			attachError = `Maksimal ${MAX_ATTACHMENTS} lampiran per pesan.`;
			return;
		}

		for (const file of files) {
			if (file.size > MAX_ATTACHMENT_MB * 1024 * 1024) {
				attachError = `"${file.name || 'File'}" melebihi batas ${MAX_ATTACHMENT_MB} MB.`;
				continue;
			}
			const kind = fileKind(file.type, file.name);
			try {
				let dataUrl = await readFileAsDataUrl(file);
				if (kind === 'image') dataUrl = await compressImage(dataUrl, file.type || 'image/png');
				const base64 = dataUrl.split(',')[1] || '';
				const mime = dataUrl.match(/^data:([^;]+);/)?.[1] || file.type || 'application/octet-stream';
				const fileName = file.name || `tangkap-layar-${new Date().toISOString().replace(/[:.]/g, '-').slice(11, 19)}.png`;
				pendingFiles = [
					...pendingFiles,
					{ name: fileName, mime, base64, previewUrl: kind === 'image' ? dataUrl : '', kind, size: file.size }
				];
			} catch (err: any) {
				attachError = `Gagal memproses "${file.name || 'file'}": ${err?.message || 'kesalahan tak dikenal'}`;
			}
		}
	}

	async function onFilesPicked(e: Event) {
		const input = e.target as HTMLInputElement;
		const files = Array.from(input.files || []);
		input.value = '';
		await processFileList(files);
	}

	function onDragOver(e: DragEvent) {
		e.preventDefault();
		if (e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
			isFileDragOver = true;
		}
	}

	function onDragLeave(e: DragEvent) {
		e.preventDefault();
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		if (
			e.clientX <= rect.left ||
			e.clientX >= rect.right ||
			e.clientY <= rect.top ||
			e.clientY >= rect.bottom
		) {
			isFileDragOver = false;
		}
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		isFileDragOver = false;
		const files = Array.from(e.dataTransfer?.files || []);
		if (files.length) {
			processFileList(files);
		}
	}

	function onPaste(e: ClipboardEvent) {
		const items = Array.from(e.clipboardData?.items || []);
		const filesToProcess: File[] = [];

		for (const item of items) {
			if (item.kind === 'file') {
				const file = item.getAsFile();
				if (file) {
					let fileName = file.name;
					if (!fileName || fileName === 'image.png') {
						const timeStr = new Date().toISOString().replace(/[:.]/g, '-').slice(11, 19);
						fileName = `tangkap-layar-${timeStr}.png`;
					}
					const renamedFile = new File([file], fileName, { type: file.type });
					filesToProcess.push(renamedFile);
				}
			}
		}

		if (filesToProcess.length > 0) {
			processFileList(filesToProcess);
		}
	}

	function removePendingFile(idx: number) {
		pendingFiles = pendingFiles.filter((_, i) => i !== idx);
	}

	async function refreshHistoryList() {
		historyLoading = true;
		const res = await listConversations();
		historyList = res.success && res.data ? res.data : [];
		historyLoading = false;
	}

	function openHistory() {
		showHistory = true;
		refreshHistoryList();
	}

	// Fase 3 — sidebar riwayat (split-pane) di mode fullscreen selalu tampil, jadi
	// muat daftar riwayat begitu masuk fullscreen (bukan hanya saat tombol ditekan).
	$effect(() => {
		if (isFullscreen && open) refreshHistoryList();
	});

	// §7#4 Asset Persistence — lampiran gambar dari riwayat (fileId di Directus assets,
	// lihat aiAttachments.ts) diambil sekali lalu di-cache sebagai blob URL — endpoint
	// /assets butuh header Authorization Firebase, tidak bisa lewat atribut src biasa.
	let imagePreviewCache = $state<Record<string, string | null>>({});
	async function loadImagePreview(fileId: string) {
		if (!fileId || imagePreviewCache[fileId] !== undefined) return;
		imagePreviewCache = { ...imagePreviewCache, [fileId]: null };
		try {
			const res = await secureDirectusFetch(`/assets/${fileId}?width=300`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const blob = await res.blob();
			imagePreviewCache = { ...imagePreviewCache, [fileId]: URL.createObjectURL(blob) };
		} catch (e: any) {
			console.error('[asisten] gagal muat preview lampiran:', e?.message);
		}
	}

	async function downloadAttachment(a: AttachmentMeta) {
		if (!a?.fileId) return;
		try {
			const res = await secureDirectusFetch(`/assets/${a.fileId}`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.download = a.name || 'lampiran';
			link.click();
			URL.revokeObjectURL(url);
		} catch (e: any) {
			console.error('[asisten] gagal unduh lampiran:', e?.message);
		}
	}

	async function loadThread(id: number) {
		const res = await getConversationMessages(id);
		if (!res.success || !res.data) return;
		threadId = id;
		messages = (res.data.messages || []).map((m: any) => ({
			role: m.role,
			content: m.content,
			chatLogId: m.role === 'assistant' ? m.id : undefined,
			feedback: null,
			attachments: Array.isArray(m.attachments) ? m.attachments : []
		}));
		for (const m of messages) {
			for (const a of m.attachments || []) {
				if (a.kind === 'image' && a.fileId) loadImagePreview(a.fileId);
			}
		}
		showHistory = false;
		queueMicrotask(() => {
			if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
		});
	}

	// Fase 6 — Smart Context: chip saran tambahan per halaman (template hardcode,
	// dikelola admin di /settings/ai-context-templates), melengkapi QUICK_ACTIONS statis.
	let dynamicSuggestions = $state<string[]>([]);
	let lastSuggestionsPath: string | null = null;
	$effect(() => {
		if (!open) return;
		const path = page.url.pathname;
		if (path === lastSuggestionsPath) return;
		lastSuggestionsPath = path;
		fetchSuggestionsForPage(path).then((s) => (dynamicSuggestions = s));
	});

	async function giveFeedback(idx: number, verdict: 'up' | 'down') {
		const m = messages[idx];
		if (!m?.chatLogId || m.feedback) return;
		messages[idx] = { ...m, feedback: verdict };
		messages = [...messages];
		const res = await sendChatFeedback({ chatLogId: m.chatLogId, threadId, verdict });
		if (!res.success) {
			messages[idx] = { ...messages[idx], feedback: null };
			messages = [...messages];
		}
	}

	// Polish murah (§5A#1 Copy message) — murni klien, tanpa panggilan server.
	async function copyMessage(idx: number) {
		const m = messages[idx];
		if (!m) return;
		try {
			await navigator.clipboard.writeText(m.content || '');
			messages[idx] = { ...m, copied: true };
			messages = [...messages];
			setTimeout(() => {
				messages[idx] = { ...messages[idx], copied: false };
				messages = [...messages];
			}, 1500);
		} catch (e: any) {
			console.error('[asisten] gagal menyalin:', e?.message);
		}
	}

	// Aksi cepat (§15.1): tiga-empat pertanyaan tersering, tinggal tekan — tidak
	// perlu merumuskan kalimat sendiri saat tangan sedang sibuk/pakai sarung tangan.
	const QUICK_ACTIONS = [
		{ label: '📦 Cek stok sparepart', query: 'cek stok sparepart ' },
		{ label: '🏗️ Status proyek', query: 'status proyek ' },
		{ label: '📋 Status P2H alat', query: 'cek status P2H terakhir untuk equipment ' },
		{ label: '🔧 Riwayat perbaikan alat', query: 'riwayat perbaikan untuk equipment ' },
		{ label: '📝 Ajukan barang', query: 'saya mau ajukan ' },
		// 5B#3 — draf WO langsung dari teks, tanpa perlu foto (siapkan_draf_tiket_maintenance
		// digeneralisasi, lihat komentar aiToolRegistry.ts).
		{ label: '🛠️ Buat WO untuk kerusakan', query: 'buatkan WO untuk equipment ' },
		{ label: '❓ Cara pakai', query: 'bagaimana cara ' }
	];

	// 5B#4 (QR scan → tanya AI, implementation_plan_asisten_ai_v2.md): "Prefill
	// context dari equipment id" — reuse QrScannerModal.svelte yang sudah dipakai
	// di seluruh app (maintenance/+page.svelte, dst), BUKAN scanner baru. Setelah
	// equipment ke-resolve, tampilkan chip aksi cepat KHUSUS equipment itu (nama
	// sudah terisi) — bukan auto-kirim, supaya pengguna tetap bisa menambah detail.
	let QrScannerModal = $state<any>(null);
	async function loadQrScannerModal() {
		QrScannerModal ??= (await import('$lib/components/scanner/QrScannerModal.svelte')).default;
	}
	let showQrScanner = $state(false);
	let scanError = $state('');
	let scannedEquipment = $state<{ id: string; name: string; code: string } | null>(null);

	async function openQrScanner() {
		scanError = '';
		await loadQrScannerModal();
		showQrScanner = true;
	}

	async function onEquipmentQrDetect(value: string) {
		showQrScanner = false;
		const code = value.replace(/^EPI:EQUIPMENT:/, '');
		const equipment = await getEquipmentByCode(code);
		if (!equipment) {
			scanError = `Equipment dengan kode "${code}" tidak ditemukan.`;
			return;
		}
		scanError = '';
		scannedEquipment = { id: equipment.id, name: equipment.name, code: equipment.code };
	}

	const EQUIPMENT_QUICK_ACTIONS = [
		{ label: '📋 Status P2H', suffix: (name: string) => `cek status P2H terakhir untuk equipment ${name}` },
		{ label: '🔧 Riwayat perbaikan', suffix: (name: string) => `riwayat perbaikan untuk equipment ${name}` },
		{ label: '🛠️ Buat WO', suffix: (name: string) => `buatkan WO untuk equipment ${name}, keluhannya ` }
	];

	function useEquipmentAction(query: string) {
		input = query;
		scannedEquipment = null;
	}

	// 5B#2 (Voice-to-report, implementation_plan_asisten_ai_v2.md): "STT + draf;
	// pakai pola draf konfirmasi yang sudah ada" — voice HANYA mengisi kotak ketik
	// (Web Speech API, gratis/klien, tanpa panggilan server baru). Draf laporan
	// kerusakan/pengajuan tetap lewat tool yang SUDAH ada (siapkan_draf_tiket_
	// maintenance/siapkan_draf_requisition) begitu teks hasil dikte dikirim —
	// tidak ada mekanisme draf baru yang diperlukan, cukup jalur masuk suara.
	// id-ID dukungannya bervariasi per browser (Android Chrome baik, iOS Safari
	// terbatas) — sembunyikan tombol total kalau API tidak ada, jangan gagal diam.
	let voiceSupported = $state(false);
	let listening = $state(false);
	let voiceError = $state('');
	let recognition: any = null;

	function initVoice() {
		if (typeof window === 'undefined') return;
		const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
		if (!SpeechRecognitionCtor) return;
		voiceSupported = true;
		recognition = new SpeechRecognitionCtor();
		recognition.lang = 'id-ID';
		recognition.interimResults = false;
		recognition.maxAlternatives = 1;
		recognition.onresult = (e: any) => {
			const transcript = e.results?.[0]?.[0]?.transcript || '';
			if (transcript) input = input ? `${input} ${transcript}` : transcript;
		};
		recognition.onerror = (e: any) => {
			listening = false;
			voiceError = e?.error === 'not-allowed' ? 'Izin mikrofon ditolak.' : 'Gagal mengenali suara — coba lagi.';
		};
		recognition.onend = () => {
			listening = false;
		};
	}

	function toggleVoice() {
		if (!recognition) return;
		voiceError = '';
		if (listening) {
			recognition.stop();
			listening = false;
			return;
		}
		try {
			recognition.start();
			listening = true;
		} catch (e) {
			// start() melempar kalau dipanggil dua kali beruntun — abaikan, bukan error pengguna.
		}
	}

	initVoice();

	function toggle() {
		asistenOpen.set(!open);
	}

	function handleButtonClick(e: MouseEvent) {
		if (dragFlag) {
			e.preventDefault();
			e.stopPropagation();
			return;
		}
		toggle();
	}

	function onPointerDown(e: PointerEvent) {
		if (!buttonEl) return;
		// Hanya respon ke klik kiri atau sentuhan
		if (e.button !== 0 && e.pointerType === 'mouse') return;
		
		isDragging = true;
		dragFlag = false;
		startX = e.clientX;
		startY = e.clientY;
		const rect = buttonEl.getBoundingClientRect();
		initialLeft = rect.left;
		initialTop = rect.top;
		buttonEl.setPointerCapture(e.pointerId);
	}

	function onPointerMove(e: PointerEvent) {
		if (!isDragging || !buttonEl) return;
		
		const dx = e.clientX - startX;
		const dy = e.clientY - startY;
		
		// Deteksi apakah digeser cukup jauh (drag vs click)
		if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
			dragFlag = true;
		}
		
		if (dragFlag) {
			let newLeft = initialLeft + dx;
			let newTop = initialTop + dy;
			
			// Batasi agar tidak keluar layar
			const maxX = window.innerWidth - buttonEl.offsetWidth;
			const maxY = window.innerHeight - buttonEl.offsetHeight;
			
			newLeft = Math.max(0, Math.min(newLeft, maxX));
			newTop = Math.max(0, Math.min(newTop, maxY));

			buttonEl.style.left = `${newLeft}px`;
			buttonEl.style.top = `${newTop}px`;
			buttonEl.style.bottom = 'auto';
			buttonEl.style.right = 'auto';
		}
	}

	function onPointerUp(e: PointerEvent) {
		if (!isDragging || !buttonEl) return;
		isDragging = false;
		buttonEl.releasePointerCapture(e.pointerId);
	}

	function useQuickAction(q: string) {
		input = q;
	}

	function escapeHtml(s: string): string {
		return String(s ?? '')
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}

	// §5A Streaming — sembunyikan ekor teks yang BISA JADI awal baris "\nSARAN:"
	// yang belum selesai diketik (dihindari kedipan: baris itu di-strip lagi &
	// dikirim terpisah sebagai chip saat event 'done', lihat extractSuggestions
	// di server). Cocokkan akhiran string yang berupa prefix "\nSARAN" sepanjang apa pun.
	function hideStreamingTail(text: string): string {
		return text.replace(/\n[ \t]*S(?:A(?:R(?:A(?:N(?::.*)?)?)?)?)?$/i, '');
	}

	// Markdown ringan → HTML, TANPA dependency baru (repo ini belum punya
	// DOMPurify). Aman by construction: seluruh teks di-escape dulu, lalu
	// hanya tag TETAP (strong/em/code/a/ul/li/br) yang disisipkan lewat
	// regex tertutup — tidak ada jalur untuk teks mentah pengguna lolos
	// sebagai tag/attribute baru. href dibatasi pola http(s):// eksplisit.
	function markdownToSafeHtml(src: string): string {
		let s = escapeHtml(src);

		// 1. Multiline code blocks (```...```)
		const codeBlocks: string[] = [];
		s = s.replace(/```(?:[a-zA-Z0-9_-]+)?\n?([\s\S]*?)```/g, (_, code) => {
			const idx = codeBlocks.length;
			codeBlocks.push(`<pre><code>${code.trim()}</code></pre>`);
			return `__CODE_BLOCK_${idx}__`;
		});

		// 2. Inline code (dibatasi dalam satu baris)
		s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');

		// 3. Bold & Italic
		s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
		s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');

		// 4. Tautan
		s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

		// 5. Pemrosesan baris demi baris (heading, list, hr)
		const lines = s.split('\n');
		let html = '';
		let inList = false;
		for (const line of lines) {
			const listMatch = line.match(/^\s*[-*]\s+(.*)/);
			const h3Match = line.match(/^\s*###\s+(.*)/);
			const h2Match = line.match(/^\s*##\s+(.*)/);
			const h1Match = line.match(/^\s*#\s+(.*)/);
			const hrMatch = line.match(/^\s*---+\s*$/);

			if (listMatch) {
				if (!inList) {
					html += '<ul>';
					inList = true;
				}
				html += `<li>${listMatch[1]}</li>`;
			} else {
				if (inList) {
					html += '</ul>';
					inList = false;
				}
				if (hrMatch) {
					html += '<hr/>';
				} else if (h3Match) {
					html += `<strong>${h3Match[1]}</strong><br/>`;
				} else if (h2Match) {
					html += `<strong class="text-base">${h2Match[1]}</strong><br/>`;
				} else if (h1Match) {
					html += `<strong class="text-lg">${h1Match[1]}</strong><br/>`;
				} else {
					html += (line || '') + '<br/>';
				}
			}
		}
		if (inList) html += '</ul>';

		// Kembalikan multiline code blocks
		codeBlocks.forEach((block, idx) => {
			html = html.replace(`__CODE_BLOCK_${idx}__<br/>`, block).replace(`__CODE_BLOCK_${idx}__`, block);
		});

		return html;
	}

	const TOOL_LABELS: Record<string, string> = {
		cari_lintas_modul: '🔎 cari lintas modul',
		status_p2h: '📋 cek status P2H',
		riwayat_perbaikan: '🔧 riwayat perbaikan',
		siapkan_draf_requisition: '📝 siapkan draf requisition',
		siapkan_draf_tiket_maintenance: '🛠️ siapkan draf tiket maintenance'
	};
	function toolLabel(name: string): string {
		return TOOL_LABELS[name] || `🔎 ${name}`;
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			send();
		}
	}

	function scrollSoon() {
		queueMicrotask(() => {
			if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
		});
	}

	function buildDoneMessage(
		data: any,
		toolsUsedAll: string[],
		text: string,
		firstImageThisTurn: PendingFile | undefined
	): ChatMessage {
		if (data?.threadId) threadId = data.threadId;
		let draft: AnyDraft | undefined = data?.draft || undefined;
		if (draft?.type === 'maintenance_ticket' && firstImageThisTurn) {
			draft = {
				...draft,
				photo: {
					name: firstImageThisTurn.name,
					mime: firstImageThisTurn.mime,
					base64: firstImageThisTurn.base64,
					previewUrl: firstImageThisTurn.previewUrl
				}
			};
		}
		return {
			role: 'assistant',
			content: data?.text || 'Maaf, saya tidak punya jawaban untuk itu.',
			toolsUsed: [...new Set([...toolsUsedAll, ...(Array.isArray(data?.tools) ? data.tools : [])])],
			draft,
			draftStatus: draft ? 'pending' : undefined,
			sourceQuestion: text,
			chatLogId: data?.chatLogId || undefined,
			feedback: null,
			suggestions: Array.isArray(data?.suggestions) ? data.suggestions : []
		};
	}

	// Jalur lama (1 request = 1 putaran tool). Fallback otomatis saat streaming
	// nonaktif/gagal SEBELUM konten apa pun mulai muncul (lihat sendViaStream()).
	async function sendViaClassic(user: any, assistantIdx: number, reqBody: any, firstImageThisTurn: PendingFile | undefined, text: string) {
		try {
			const CLIENT_TIMEOUT_MS = 65_000;
			const deadline = performance.now() + CLIENT_TIMEOUT_MS;
			const MAX_ROUNDS_CLIENT_GUARD = 8;

			let continuationToken: string | undefined;
			let toolsUsedAll: string[] = [];

			for (let round = 0; round < MAX_ROUNDS_CLIENT_GUARD; round++) {
				const remainingMs = deadline - performance.now();
				if (remainingMs <= 0) {
					throw new Error(`Waktu tunggu habis (${Math.round(CLIENT_TIMEOUT_MS / 1000)} detik) — respons tidak pernah sampai dari server.`);
				}

				const token = await user.getIdToken();
				const controller = new AbortController();
				const clientTimeout = setTimeout(() => controller.abort(), remainingMs);

				let res: Response;
				try {
					res = await fetch('/api/ai-assistant', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
						body: JSON.stringify(
							continuationToken ? { continuationToken, page: reqBody.page, params: reqBody.params, sessionId: reqBody.sessionId } : reqBody
						),
						signal: controller.signal
					});
				} catch (e: any) {
					if (e?.name === 'AbortError') {
						throw new Error(`Waktu tunggu habis (${Math.round(CLIENT_TIMEOUT_MS / 1000)} detik) — respons tidak pernah sampai dari server.`);
					}
					throw e;
				} finally {
					clearTimeout(clientTimeout);
				}

				const data = await res.json().catch(() => null);
				if (!res.ok) throw new Error(data?.message || `Gagal menghubungi asisten (${res.status}).`);

				if (data?.status === 'in_progress') {
					const namesThisRound: string[] = Array.isArray(data.toolsThisRound) ? data.toolsThisRound : [];
					toolsUsedAll = [...toolsUsedAll, ...namesThisRound];
					messages[assistantIdx] = { ...messages[assistantIdx], tool: namesThisRound.map(toolLabel).join(', ') || 'Bekerja…' };
					messages = [...messages];
					scrollSoon();
					continuationToken = data.continuationToken;
					continue;
				}

				// status === 'done'
				messages[assistantIdx] = buildDoneMessage(data, toolsUsedAll, text, firstImageThisTurn);
				messages = [...messages];
				return;
			}

			throw new Error('Asisten memakai terlalu banyak putaran tool. Coba pertanyaan yang lebih spesifik.');
		} catch (e: any) {
			messages[assistantIdx] = { role: 'assistant', content: `⚠️ ${e?.message || 'Terjadi kesalahan.'}` };
			messages = [...messages];
		}
	}

	// §5A Streaming — SATU request menahan koneksi (SSE) selama seluruh loop tool-use
	// server. @returns true bila sudah ditangani (sukses ATAU error yang ditampilkan)
	// — false HANYA bila gagal/nonaktif SEBELUM konten apa pun diterima, sinyal bagi
	// send() untuk fallback ke sendViaClassic().
	async function sendViaStream(
		user: any,
		assistantIdx: number,
		reqBody: any,
		firstImageThisTurn: PendingFile | undefined,
		text: string
	): Promise<boolean> {
		let startedReceiving = false;
		try {
			const token = await user.getIdToken();
			const res = await fetch('/api/ai-assistant/stream', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body: JSON.stringify(reqBody)
			});

			const contentType = res.headers.get('content-type') || '';
			if (!res.ok || !contentType.includes('text/event-stream') || !res.body) {
				streamingSupported = false;
				return false;
			}
			streamingSupported = true;

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			let toolsUsedAll: string[] = [];
			let rawText = '';

			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				let idx: number;
				while ((idx = buffer.indexOf('\n\n')) !== -1) {
					const rawEvent = buffer.slice(0, idx);
					buffer = buffer.slice(idx + 2);
					const eventLine = rawEvent.split('\n').find((l) => l.startsWith('event:'));
					const dataLine = rawEvent.split('\n').find((l) => l.startsWith('data:'));
					if (!dataLine) continue;
					const evtType = eventLine ? eventLine.slice(6).trim() : 'message';
					let data: any;
					try {
						data = JSON.parse(dataLine.slice(5).trim());
					} catch {
						continue;
					}
					startedReceiving = true;

					if (evtType === 'tool') {
						toolsUsedAll = [...toolsUsedAll, data.name];
						messages[assistantIdx] = { ...messages[assistantIdx], tool: toolLabel(data.name) };
						messages = [...messages];
						scrollSoon();
					} else if (evtType === 'delta') {
						rawText += data.text || '';
						messages[assistantIdx] = { ...messages[assistantIdx], tool: '', content: hideStreamingTail(rawText) };
						messages = [...messages];
						scrollSoon();
					} else if (evtType === 'done') {
						messages[assistantIdx] = buildDoneMessage(data, toolsUsedAll, text, firstImageThisTurn);
						messages = [...messages];
						scrollSoon();
						return true;
					} else if (evtType === 'error') {
						messages[assistantIdx] = { role: 'assistant', content: `⚠️ ${data.message || 'Terjadi kesalahan.'}` };
						messages = [...messages];
						scrollSoon();
						return true;
					}
				}
			}

			if (!startedReceiving) {
				streamingSupported = false;
				return false;
			}
			const current = messages[assistantIdx];
			if (!current?.content) {
				messages[assistantIdx] = { ...current, tool: '', content: '⚠️ Koneksi streaming terputus sebelum selesai.' };
				messages = [...messages];
			}
			return true;
		} catch (e: any) {
			if (!startedReceiving) {
				streamingSupported = false;
				return false;
			}
			messages[assistantIdx] = { role: 'assistant', content: `⚠️ ${e?.message || 'Terjadi kesalahan.'}` };
			messages = [...messages];
			scrollSoon();
			return true;
		}
	}

	async function send() {
		const rawText = input.trim();
		if ((!rawText && !pendingFiles.length) || streaming) return;
		// Pesan tanpa teks (hanya lampiran) tetap butuh content string non-kosong
		// supaya lolos validasi server (`Pesan terakhir harus dari pengguna`).
		const text = rawText || 'Tolong lihat lampiran berikut.';

		input = '';
		const attachmentsForRequest = pendingFiles.map((f) => ({ name: f.name, mime: f.mime, base64: f.base64 }));
		// previewUrl lokal (blob klien) untuk pesan yang BARU dikirim — instan, tidak
		// perlu menunggu upload server. Setelah reload riwayat, thumbnail datang dari
		// fileId (Directus assets) lewat loadImagePreview() di loadThread().
		const attachmentsMetaForDisplay: AttachmentMeta[] = pendingFiles.map((f) => ({
			name: f.name,
			mime: f.mime,
			kind: f.kind,
			size: f.size,
			previewUrl: f.previewUrl
		}));
		// 5B#1 — foto (bila ada) dijahit balik ke draf tiket maintenance saat respons
		// tiba (base64 hanya hidup di memori klien untuk giliran ini, tidak dipersist).
		const firstImageThisTurn = pendingFiles.find((f) => f.kind === 'image');
		pendingFiles = [];
		attachError = '';
		messages = [...messages, { role: 'user', content: text, attachments: attachmentsMetaForDisplay }];
		const assistantIdx = messages.length;
		messages = [...messages, { role: 'assistant', content: '', tool: 'Berpikir…' }];
		streaming = true;

		const user = auth?.currentUser;
		if (!user) {
			messages[assistantIdx] = { role: 'assistant', content: '⚠️ Sesi tidak ditemukan. Silakan login ulang.' };
			messages = [...messages];
			streaming = false;
			return;
		}

		const history = messages
			.slice(0, assistantIdx)
			.filter((m) => m.content && m.content.trim())
			.map((m) => ({ role: m.role, content: m.content }));

		const reqBody = {
			messages: history,
			page: page.url.pathname,
			params: page.params,
			sessionId,
			threadId,
			attachments: attachmentsForRequest
		};

		if (streamingSupported !== false) {
			const handled = await sendViaStream(user, assistantIdx, reqBody, firstImageThisTurn, text);
			if (handled) {
				streaming = false;
				scrollSoon();
				return;
			}
		}

		await sendViaClassic(user, assistantIdx, reqBody, firstImageThisTurn, text);
		streaming = false;
		scrollSoon();
	}

	function clearChat() {
		if (streaming) return;
		messages = [];
		threadId = null;
		showHistory = false;
		pendingFiles = [];
		attachError = '';
	}

	// Fase 4 (Export PDF) §4 — render server-side (pdfmake, lib/server/asistenPdf.ts),
	// bukan lib client seperti jsPDF di admin — tidak menambah apa pun ke bundle mobile.
	let exportingPdf = $state(false);
	async function exportPdf() {
		if (!messages.length || exportingPdf) return;
		exportingPdf = true;
		try {
			const user = auth?.currentUser;
			if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
			const token = await user.getIdToken();
			const res = await fetch('/api/ai-assistant/export-pdf', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body: JSON.stringify({ messages: messages.map((m) => ({ role: m.role, content: m.content })) })
			});
			if (!res.ok) throw new Error(`Gagal membuat PDF (${res.status})`);
			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.download = `percakapan-asisten-ai-${Date.now()}.pdf`;
			link.click();
			URL.revokeObjectURL(url);
		} catch (e: any) {
			console.error('[asisten] gagal export PDF:', e?.message);
		} finally {
			exportingPdf = false;
		}
	}

	function cancelDraft(idx: number) {
		const m = messages[idx];
		if (!m) return;
		messages[idx] = { ...m, draftStatus: 'cancelled' };
		messages = messages;
	}

	// Fase 2 (§8): SATU-SATUNYA jalur yang benar-benar menulis data. Dipanggil
	// hanya saat pengguna menekan tombol ini sendiri — bukan otomatis dari AI.
	// 5B#5 Offline queue — helper dipakai baik oleh confirmDraft() (percobaan
	// pertama, live) maupun flushQueuedDrafts() (retry, dari IndexedDB).
	async function sendDraftRequest(endpoint: string, body: Record<string, unknown>): Promise<any> {
		const user = auth?.currentUser;
		if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
		const token = await user.getIdToken();
		const res = await fetch(endpoint, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify(body)
		});
		const data = await res.json().catch(() => null);
		if (!res.ok) throw new Error(data?.message || `Gagal membuat draf (${res.status}).`);
		return data;
	}

	let queuedDraftCount = $state(0);
	async function refreshQueuedCount() {
		queuedDraftCount = (await getQueuedAsistenDrafts()).length;
	}

	let flushingQueue = $state(false);
	async function flushQueuedDrafts() {
		if (flushingQueue) return;
		flushingQueue = true;
		await flushAsistenDraftQueue((entry) => sendDraftRequest(entry.endpoint, entry.body));
		flushingQueue = false;
		await refreshQueuedCount();
	}

	registerAsistenDraftAutoFlush((entry) => sendDraftRequest(entry.endpoint, entry.body));
	refreshQueuedCount();

	async function confirmDraft(idx: number) {
		const m = messages[idx];
		if (!m?.draft) return;
		messages[idx] = { ...m, draftStatus: 'pending' };
		messages = messages;

		const draftForRequest = m.draft;
		const isMaintenance = draftForRequest.type === 'maintenance_ticket';
		const endpoint = isMaintenance ? '/api/ai-assistant/draft-maintenance-ticket' : '/api/ai-assistant/draft-requisition';
		// Dibuat SEBELUM percobaan kirim pertama (bukan hanya saat retry) — kalau
		// percobaan pertama ini sendiri sukses di server tapi responsnya tak sempat
		// sampai (sinyal putus di tengah), retry manapun tetap idempotent lewat ini.
		const clientTxnId = crypto.randomUUID();
		const body: Record<string, unknown> =
			draftForRequest.type === 'maintenance_ticket'
				? {
						draft: draftForRequest,
						sourceQuestion: m.sourceQuestion || '',
						client_txn_id: clientTxnId,
						photo: draftForRequest.photo
							? { name: draftForRequest.photo.name, mime: draftForRequest.photo.mime, base64: draftForRequest.photo.base64 }
							: undefined
					}
				: { draft: draftForRequest, sourceQuestion: m.sourceQuestion || '', client_txn_id: clientTxnId };

		try {
			const data = await sendDraftRequest(endpoint, body);
			messages[idx] = {
				...m,
				draftStatus: 'confirmed',
				draftResultText: isMaintenance
					? `Tiket maintenance ${data?.data?.wo_number || ''} berhasil dibuat dan menunggu ditindaklanjuti supervisor.`
					: `Requisition ${data?.data?.requisitionNumber || ''} berhasil dibuat dan menunggu persetujuan.`
			};
		} catch (e: any) {
			// Bedakan gagal JARINGAN (offline/timeout — fetch() melempar TypeError,
			// tanpa pernah sampai ke server) dari PENOLAKAN server (400/403/dst, sudah
			// diterima & ditolak). HANYA yang pertama pantas diantre — yang kedua akan
			// gagal lagi persis sama walau di-retry seribu kali.
			const isNetworkError = e instanceof TypeError || (typeof navigator !== 'undefined' && !navigator.onLine);
			if (isNetworkError) {
				try {
					await enqueueAsistenDraft({
						client_txn_id: clientTxnId,
						kind: isMaintenance ? 'maintenance_ticket' : 'requisition',
						endpoint,
						body,
						label: isMaintenance ? `Tiket: ${draftForRequest.equipmentName}` : `Requisition: ${draftForRequest.items?.[0]?.nama_barang || ''}`,
						createdAt: new Date().toISOString()
					});
					await refreshQueuedCount();
					messages[idx] = { ...m, draftStatus: 'queued', draftResultText: 'Sinyal terputus — draf disimpan, akan dikirim otomatis saat online kembali.' };
				} catch (queueErr: any) {
					messages[idx] = { ...m, draftStatus: 'error', draftResultText: e?.message || 'Gagal membuat draf (offline, dan gagal menyimpan antrean).' };
				}
			} else {
				messages[idx] = { ...m, draftStatus: 'error', draftResultText: e?.message || 'Gagal membuat draf.' };
			}
		} finally {
			messages = messages;
		}
	}
</script>

<svelte:window onkeydown={onGlobalKey} />

<!-- Tombol mengambang -->
<button
	bind:this={buttonEl}
	type="button"
	onclick={handleButtonClick}
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
	class="fixed bottom-20 right-4 lg:bottom-6 z-[9990] w-14 h-14 rounded-full bg-cyan-600 hover:bg-cyan-700 text-white shadow-2xl flex items-center justify-center text-2xl focus:outline-none focus:ring-4 focus:ring-cyan-300 select-none {dragFlag ? 'cursor-grabbing' : 'cursor-pointer hover:scale-105 transition-transform'}"
	style="touch-action: none;"
	aria-label={open ? 'Tutup Asisten AI' : 'Buka Asisten AI'}
	title="Asisten AI"
>
	{open ? '✕' : '🤖'}
</button>

<!-- Lembar bawah -->
{#if open}
	<div class="fixed inset-0 z-[9989] bg-black/30" onclick={toggle} aria-hidden="true"></div>
	<div
		ondragenter={onDragOver}
		ondragover={onDragOver}
		ondragleave={onDragLeave}
		ondrop={onDrop}
		onpaste={onPaste}
		class="relative {isFullscreen
			? 'fixed inset-0 md:inset-3 z-[9990] bg-white rounded-none md:rounded-2xl shadow-2xl flex flex-col overflow-hidden transition-all duration-200'
			: 'fixed left-0 right-0 bottom-0 z-[9990] bg-white rounded-t-2xl shadow-2xl flex flex-col overflow-hidden transition-all duration-200'}"
		style={isFullscreen ? 'height: 100%;' : 'height: min(75vh, 640px);'}
	>
		{#if isFileDragOver}
			<div class="absolute inset-0 z-[9999] bg-cyan-600/90 backdrop-blur-sm flex flex-col items-center justify-center text-white border-2 border-dashed border-white m-2 rounded-2xl transition-all duration-200 pointer-events-none">
				<div class="text-4xl mb-2 animate-bounce">📥</div>
				<p class="font-semibold text-base">Lepaskan file di sini</p>
				<p class="text-xs text-cyan-100 mt-1">Gambar, PDF, CSV, atau TXT (maks. 6 MB)</p>
			</div>
		{/if}
		<div class="px-4 py-3 bg-cyan-600 text-white flex items-center gap-3 shrink-0">
			<div class="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center text-lg">🤖</div>
			<div class="flex-1 min-w-0">
				<div class="font-semibold leading-tight">Asisten AI</div>
				<div class="text-xs text-cyan-100">Lapangan · bisa baca data</div>
			</div>
			{#if !isFullscreen}
				<button type="button" onclick={openHistory} class="text-cyan-100 hover:text-white text-xs px-2 py-1 rounded">
					🕘 Riwayat
				</button>
			{/if}
			<button
				type="button"
				onclick={clearChat}
				disabled={streaming || (!threadId && messages.length === 0 && !showHistory)}
				class="text-cyan-100 hover:text-white text-xs px-2 py-1 rounded disabled:opacity-40"
			>
				+ Baru
			</button>
			<button
				type="button"
				onclick={exportPdf}
				disabled={exportingPdf || !messages.length}
				class="text-cyan-100 hover:text-white text-xs px-2 py-1 rounded disabled:opacity-40"
				title="Export percakapan ke PDF"
				aria-label="Export percakapan ke PDF"
			>
				{exportingPdf ? '⏳' : '📄'}
			</button>
			<button
				type="button"
				onclick={toggleFullscreen}
				class="text-cyan-100 hover:text-white text-xs px-2 py-1 rounded flex items-center justify-center font-mono text-sm"
				title={isFullscreen ? 'Kecilkan' : 'Layar penuh'}
				aria-label={isFullscreen ? 'Kecilkan' : 'Layar penuh'}
			>
				{isFullscreen ? '🗗' : '⛶'}
			</button>
			<button type="button" onclick={toggle} class="text-cyan-100 hover:text-white text-xl leading-none px-1" aria-label="Tutup">
				✕
			</button>
		</div>

		{#if queuedDraftCount > 0}
			<!-- 5B#5 Offline queue — draf yang tersimpan lokal (IndexedDB) saat sinyal
			     putus, auto-terkirim ketika online kembali; tombol ini untuk coba manual. -->
			<div class="px-3 py-1.5 bg-blue-50 border-b border-blue-100 flex items-center justify-between text-xs text-blue-700 shrink-0">
				<span>📴 {queuedDraftCount} draf menunggu koneksi</span>
				<button type="button" onclick={flushQueuedDrafts} disabled={flushingQueue} class="text-blue-600 hover:underline disabled:opacity-50">
					{flushingQueue ? 'Mengirim…' : 'Kirim sekarang'}
				</button>
			</div>
		{/if}

		<div class="flex-1 flex min-h-0">
			{#if isFullscreen}
				<!-- Fase 3 (§3) — sidebar riwayat split-pane, HANYA saat layar penuh & lebar
				     cukup (md+) — di HP sempit tetap pakai tampilan riwayat penuh lama. -->
				<div class="hidden md:flex md:flex-col w-64 shrink-0 border-r border-gray-200 bg-gray-50 overflow-hidden">
					<div class="flex items-center justify-between px-3 py-2.5 border-b border-gray-200 shrink-0">
						<span class="text-xs font-semibold text-gray-500">Riwayat Percakapan</span>
						<button type="button" onclick={refreshHistoryList} class="text-xs text-cyan-600 hover:underline" title="Muat ulang">🔄</button>
					</div>
					<div class="flex-1 overflow-y-auto p-2 space-y-1.5">
						{#if historyLoading}
							<div class="text-xs text-gray-400 text-center py-6">Memuat…</div>
						{:else if !historyList.length}
							<div class="text-xs text-gray-400 text-center py-6">Belum ada percakapan tersimpan.</div>
						{:else}
							{#each historyList as t (t.id)}
								<button
									type="button"
									onclick={() => loadThread(t.id)}
									class="w-full text-left px-3 py-2 rounded-xl border text-xs {threadId === t.id
										? 'bg-cyan-50 border-cyan-300'
										: 'bg-white border-gray-200 hover:border-cyan-300 hover:bg-cyan-50'}"
								>
									<div class="font-medium text-gray-700 truncate">{t.title || '(Percakapan baru)'}</div>
									<div class="text-[10px] text-gray-400 mt-0.5">{t.last_message_at ? new Date(t.last_message_at).toLocaleString('id-ID') : ''}</div>
								</button>
							{/each}
						{/if}
					</div>
				</div>
			{/if}
			<div class="flex-1 flex flex-col min-h-0">
		{#if showHistory && !isFullscreen}
			<div class="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-gray-50">
				<div class="flex items-center justify-between mb-1">
					<span class="text-xs font-semibold text-gray-500">Percakapan sebelumnya</span>
					<button type="button" onclick={() => (showHistory = false)} class="text-xs text-cyan-600 hover:underline">Tutup</button>
				</div>
				{#if historyLoading}
					<div class="text-xs text-gray-400 text-center py-6">Memuat…</div>
				{:else if !historyList.length}
					<div class="text-xs text-gray-400 text-center py-6">Belum ada percakapan tersimpan.</div>
				{:else}
					{#each historyList as t (t.id)}
						<button
							type="button"
							onclick={() => loadThread(t.id)}
							class="w-full text-left px-3 py-2 rounded-xl bg-white border border-gray-200 hover:border-cyan-300 hover:bg-cyan-50 text-xs"
						>
							<div class="font-medium text-gray-700 truncate">{t.title || '(Percakapan baru)'}</div>
							<div class="text-[10px] text-gray-400 mt-0.5">{t.last_message_at ? new Date(t.last_message_at).toLocaleString('id-ID') : ''}</div>
						</button>
					{/each}
				{/if}
			</div>
		{:else}
		{#if messages.length === 0}
			<div class="px-4 pt-4 shrink-0">
				<p class="text-xs font-medium text-gray-500 mb-2">Aksi cepat:</p>
				<div class="flex flex-wrap gap-2">
					{#each QUICK_ACTIONS as qa}
						<button
							type="button"
							onclick={() => useQuickAction(qa.query)}
							class="text-xs px-3 py-2 rounded-full bg-cyan-50 text-cyan-700 border border-cyan-100 hover:bg-cyan-100"
						>
							{qa.label}
						</button>
					{/each}
					{#each dynamicSuggestions as s}
						<button
							type="button"
							onclick={() => (input = s)}
							class="text-xs px-3 py-2 rounded-full bg-violet-50 text-violet-700 border border-violet-100 hover:bg-violet-100"
						>
							💡 {s}
						</button>
					{/each}
				</div>
			</div>
		{/if}

		<div bind:this={scrollEl} class="flex-1 overflow-y-auto px-3 py-4 space-y-3 bg-gray-50">
			{#if messages.length === 0}
				<div class="h-full flex flex-col items-center justify-center text-center text-gray-400 px-6">
					<div class="text-4xl mb-3">💬</div>
					<p class="text-sm font-medium text-gray-500">Halo! Saya Asisten AI Eltama.</p>
					<p class="text-xs mt-1">Tekan aksi cepat di atas, atau ketik pertanyaan.</p>
				</div>
			{/if}

			{#each messages as m, i (i)}
				<div class="flex {m.role === 'user' ? 'justify-end' : 'justify-start'}">
					<div
						class="max-w-[85%] rounded-2xl px-3 py-2 text-sm break-words {m.role === 'user'
							? 'bg-cyan-600 text-white rounded-br-sm whitespace-pre-wrap'
							: 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm'}"
					>
						{#if m.content}
							{#if m.role === 'assistant'}
								<!-- eslint-disable-next-line svelte/no-at-html-tags -- markdownToSafeHtml() aman by construction, lihat komentar fungsinya -->
								<div class="asisten-markdown">{@html markdownToSafeHtml(m.content)}</div>
								{#if m.toolsUsed?.length}
									<div class="mt-1.5 flex flex-wrap gap-1">
										{#each m.toolsUsed as t}
											<span class="text-[10px] leading-none px-1.5 py-1 rounded-full bg-violet-50 text-violet-600 border border-violet-100">
												{toolLabel(t)}
											</span>
										{/each}
									</div>
								{/if}
								<div class="mt-1.5 flex items-center gap-1.5">
									<button
										type="button"
										onclick={() => copyMessage(i)}
										class="text-xs px-1.5 py-0.5 rounded hover:bg-gray-100"
										aria-label="Salin jawaban"
									>{m.copied ? '✅' : '📋'}</button>
									{#if m.chatLogId}
										<button
											type="button"
											onclick={() => giveFeedback(i, 'up')}
											disabled={!!m.feedback}
											class="text-xs px-1.5 py-0.5 rounded {m.feedback === 'up' ? 'bg-green-100' : 'hover:bg-gray-100'} disabled:cursor-default"
											aria-label="Jawaban ini membantu"
										>👍</button>
										<button
											type="button"
											onclick={() => giveFeedback(i, 'down')}
											disabled={!!m.feedback}
											class="text-xs px-1.5 py-0.5 rounded {m.feedback === 'down' ? 'bg-red-100' : 'hover:bg-gray-100'} disabled:cursor-default"
											aria-label="Jawaban ini tidak membantu"
										>👎</button>
									{/if}
								</div>
								{#if m.suggestions?.length}
									<div class="mt-1.5 flex flex-wrap gap-1.5">
										{#each m.suggestions as s}
											<button
												type="button"
												onclick={() => (input = s)}
												class="text-xs px-2.5 py-1 rounded-full bg-cyan-50 text-cyan-700 border border-cyan-100 hover:bg-cyan-100"
											>
												💡 {s}
											</button>
										{/each}
									</div>
								{/if}

								<!-- Fase 2 (§8): kartu konfirmasi draf — TIDAK ADA yang tertulis ke data
								     produksi sampai pengguna menekan "Buat Draf" di sini sendiri. -->
								{#if m.draft && m.draftStatus === 'pending' && m.draft.type === 'requisition'}
									<div class="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-gray-700">
										<div class="font-semibold text-amber-800 mb-1">📝 Draf Requisition (belum dibuat)</div>
										{#each m.draft.items as it}
											<div>{it.quantity_requested} {it.units || ''} — {it.nama_barang}</div>
										{/each}
										{#if m.draft.tujuanPenggunaan}
											<div class="mt-1 text-gray-500">Keperluan: {m.draft.tujuanPenggunaan}</div>
										{/if}
										<div class="mt-2 flex gap-2">
											<button
												type="button"
												onclick={() => confirmDraft(i)}
												class="px-3 py-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold"
											>
												Buat Draf
											</button>
											<button
												type="button"
												onclick={() => cancelDraft(i)}
												class="px-3 py-1.5 rounded-md border border-gray-300 text-gray-600 text-xs hover:bg-gray-100"
											>
												Batal
											</button>
										</div>
									</div>
								{:else if m.draft && m.draftStatus === 'pending' && m.draft.type === 'maintenance_ticket'}
									<div class="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-gray-700">
										<div class="font-semibold text-amber-800 mb-1">🛠️ Draf Tiket Maintenance (belum dibuat)</div>
										{#if m.draft.photo?.previewUrl}
											<img src={m.draft.photo.previewUrl} alt="Foto kerusakan" class="w-full max-h-32 object-cover rounded-md mb-1.5" />
										{/if}
										<div class="font-medium text-gray-800">{m.draft.equipmentName}</div>
										<div class="text-gray-600 whitespace-pre-wrap">{m.draft.keluhan}</div>
										{#if m.draft.urgency === 'darurat'}
											<div class="mt-1 text-red-600 font-semibold">⚠️ Darurat</div>
										{/if}
										<div class="mt-2 flex gap-2">
											<button
												type="button"
												onclick={() => confirmDraft(i)}
												class="px-3 py-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold"
											>
												Buat Tiket
											</button>
											<button
												type="button"
												onclick={() => cancelDraft(i)}
												class="px-3 py-1.5 rounded-md border border-gray-300 text-gray-600 text-xs hover:bg-gray-100"
											>
												Batal
											</button>
										</div>
									</div>
								{:else if m.draftStatus === 'confirmed'}
									<div class="mt-2 rounded-lg border border-green-200 bg-green-50 p-2 text-xs text-green-800">
										✅ {m.draftResultText}
									</div>
								{:else if m.draftStatus === 'cancelled'}
									<div class="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-2 text-xs text-gray-500">Draf dibatalkan.</div>
								{:else if m.draftStatus === 'queued'}
									<div class="mt-2 rounded-lg border border-blue-200 bg-blue-50 p-2 text-xs text-blue-700">📴 {m.draftResultText}</div>
								{:else if m.draftStatus === 'error'}
									<div class="mt-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">⚠️ {m.draftResultText}</div>
								{/if}
							{:else}
								{m.content}
							{/if}
						{:else if m.role === 'assistant' && streaming}
							{#if m.tool}
								<div class="text-xs text-violet-600 italic mb-1">{m.tool}</div>
							{/if}
							<span class="inline-flex gap-1 text-gray-400">
								<span class="animate-bounce">•</span>
								<span class="animate-bounce [animation-delay:0.15s]">•</span>
								<span class="animate-bounce [animation-delay:0.3s]">•</span>
							</span>
						{/if}
						{#if m.attachments?.length}
							<div class="mt-1.5 flex flex-wrap gap-1.5">
								{#each m.attachments as a}
									{@const previewUrl = a.previewUrl || (a.fileId ? imagePreviewCache[a.fileId] : null)}
									{#if a.kind === 'image' && previewUrl}
										<button type="button" onclick={() => window.open(previewUrl, '_blank')} title="{a.name} · {Math.round((a.size || 0) / 1024)} KB" class="block">
											<img src={previewUrl} alt={a.name} class="max-w-[140px] max-h-[140px] rounded-lg border border-gray-200 object-cover" />
										</button>
									{:else if a.fileId}
										<button
											type="button"
											onclick={() => downloadAttachment(a)}
											class="text-[10px] leading-none px-1.5 py-1 rounded-full border {m.role === 'user'
												? 'bg-cyan-500/30 border-cyan-300/40 text-white hover:bg-cyan-500/50'
												: 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'}"
											title="Unduh {a.name} · {Math.round((a.size || 0) / 1024)} KB"
										>
											{a.kind === 'pdf' ? '📄' : '📎'} {a.name} ⬇️
										</button>
									{:else}
										<span
											class="text-[10px] leading-none px-1.5 py-1 rounded-full border {m.role === 'user'
												? 'bg-cyan-500/30 border-cyan-300/40 text-white'
												: 'bg-gray-50 text-gray-500 border-gray-200'}"
											title="{a.name} · {Math.round((a.size || 0) / 1024)} KB"
										>
											{a.kind === 'image' ? '🖼️' : a.kind === 'pdf' ? '📄' : '📎'} {a.name}
										</span>
									{/if}
								{/each}
							</div>
						{/if}
					</div>
				</div>
			{/each}
		</div>

		<div class="p-3 border-t border-gray-200 bg-white shrink-0" style="padding-bottom: max(0.75rem, env(safe-area-inset-bottom));">
			{#if voiceError}
				<p class="text-xs text-red-600 mb-1.5">{voiceError}</p>
			{/if}
			{#if scanError}
				<p class="text-xs text-red-600 mb-1.5">{scanError}</p>
			{/if}
			{#if scannedEquipment}
				<div class="mb-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2">
					<div class="flex items-center justify-between mb-1.5">
						<span class="text-xs font-medium text-emerald-800">📷 {scannedEquipment.name}</span>
						<button type="button" onclick={() => (scannedEquipment = null)} class="text-xs text-emerald-600 hover:underline">✕</button>
					</div>
					<div class="flex flex-wrap gap-1.5">
						{#each EQUIPMENT_QUICK_ACTIONS as qa}
							<button
								type="button"
								onclick={() => useEquipmentAction(qa.suffix(scannedEquipment?.name || ''))}
								class="text-xs px-2.5 py-1 rounded-full bg-white text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
							>
								{qa.label}
							</button>
						{/each}
					</div>
				</div>
			{/if}
			{#if attachError}
				<p class="text-xs text-red-600 mb-1.5">{attachError}</p>
			{/if}
			{#if pendingFiles.length}
				<div class="flex flex-wrap gap-1.5 mb-2">
					{#each pendingFiles as f, idx}
						<div class="relative flex items-center gap-1 pl-1.5 pr-1 py-1 rounded-lg bg-gray-100 border border-gray-200 text-xs">
							{#if f.previewUrl}
								<img src={f.previewUrl} alt={f.name} class="w-6 h-6 rounded object-cover" />
							{:else}
								<span>{f.kind === 'pdf' ? '📄' : '📎'}</span>
							{/if}
							<span class="max-w-[90px] truncate text-gray-600">{f.name}</span>
							<button
								type="button"
								onclick={() => removePendingFile(idx)}
								class="w-4 h-4 rounded-full bg-gray-300 hover:bg-gray-400 text-white flex items-center justify-center text-[10px] shrink-0"
								aria-label="Hapus lampiran"
							>✕</button>
						</div>
					{/each}
				</div>
			{/if}
			<div class="flex items-end gap-2">
				<input
					bind:this={fileInputEl}
					type="file"
					accept={ATTACHMENT_ACCEPT}
					multiple
					class="hidden"
					onchange={onFilesPicked}
				/>
				<button
					type="button"
					onclick={() => fileInputEl?.click()}
					disabled={streaming || pendingFiles.length >= MAX_ATTACHMENTS}
					class="w-10 h-10 shrink-0 rounded-full border border-gray-300 text-gray-500 hover:bg-gray-50 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
					aria-label="Lampirkan foto/PDF/teks"
				>
					📎
				</button>
				<button
					type="button"
					onclick={openQrScanner}
					disabled={streaming}
					class="w-10 h-10 shrink-0 rounded-full border border-gray-300 text-gray-500 hover:bg-gray-50 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
					aria-label="Scan QR equipment"
				>
					📷
				</button>
				{#if voiceSupported}
					<button
						type="button"
						onclick={toggleVoice}
						disabled={streaming}
						class="w-10 h-10 shrink-0 rounded-full border flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed {listening
							? 'border-red-300 bg-red-50 text-red-600 animate-pulse'
							: 'border-gray-300 text-gray-500 hover:bg-gray-50'}"
						aria-label={listening ? 'Berhenti merekam' : 'Ketik pakai suara'}
						title={listening ? 'Mendengarkan… tekan lagi untuk berhenti' : 'Ketik pakai suara'}
					>
						🎤
					</button>
				{/if}
				<textarea
					bind:this={textareaEl}
					bind:value={input}
					onkeydown={onKey}
					onpaste={onPaste}
					oninput={autoResizeTextarea}
					rows="1"
					placeholder="Ketik pertanyaan…"
					class="flex-1 resize-none max-h-28 rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:border-cyan-400"
				></textarea>
				<button
					type="button"
					onclick={send}
					disabled={streaming || (!input.trim() && !pendingFiles.length)}
					class="w-10 h-10 shrink-0 rounded-full bg-cyan-600 hover:bg-cyan-700 text-white flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
					aria-label="Kirim"
				>
					{#if streaming}⏳{:else}➤{/if}
				</button>
			</div>
		</div>
		{/if}
			</div>
		</div>
	</div>
{/if}

{#if showQrScanner && QrScannerModal}
	<QrScannerModal expectedPrefix="EPI:EQUIPMENT:" onDetect={onEquipmentQrDetect} onClose={() => (showQrScanner = false)} />
{/if}

<style>
	.asisten-markdown :global(ul) {
		margin: 0.35rem 0;
		padding-left: 1.25rem;
		list-style: disc;
	}
	.asisten-markdown :global(li) {
		margin-bottom: 0.15rem;
	}
	.asisten-markdown :global(a) {
		color: #0891b2;
		text-decoration: underline;
	}
	:root[data-theme='dark'] .asisten-markdown :global(a) {
		color: #22d3ee;
	}
	.asisten-markdown :global(code) {
		background: rgba(0, 0, 0, 0.06);
		color: inherit;
		padding: 0.1rem 0.35rem;
		border-radius: 0.25rem;
		font-size: 0.85em;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
	}
	:root[data-theme='dark'] .asisten-markdown :global(code) {
		background: rgba(255, 255, 255, 0.15);
		color: #f1f5f9;
	}
	.asisten-markdown :global(pre) {
		background: #f1f5f9;
		color: #0f172a;
		padding: 0.5rem 0.75rem;
		border-radius: 0.375rem;
		overflow-x: auto;
		margin: 0.5rem 0;
		font-size: 0.85em;
	}
	.asisten-markdown :global(pre code) {
		background: transparent;
		padding: 0;
		color: inherit;
	}
	:root[data-theme='dark'] .asisten-markdown :global(pre) {
		background: #1e293b;
		color: #f1f5f9;
	}
	.asisten-markdown :global(hr) {
		border: 0;
		border-top: 1px solid #e2e8f0;
		margin: 0.5rem 0;
	}
	:root[data-theme='dark'] .asisten-markdown :global(hr) {
		border-top-color: #334155;
	}
</style>
