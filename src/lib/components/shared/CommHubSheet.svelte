<!-- CommHubSheet.svelte — Unified Communication Hub Fase 4 (dashboard lapangan).
     Lembar-bawah TERPISAH dari AsistenSheet.svelte (sengaja tidak digabung — AsistenSheet
     sudah 1600+ baris logic AI/draft/voice/QR yang rawan regresi bila direfactor; komponen
     ini berdiri sendiri dengan tombol mengambang sendiri, ditumpuk di atas tombol Asisten AI).
     Dua tab:
       💬 Omnichannel — READ-ONLY, kebijakan K-4: PL tidak boleh chat langsung ke pelanggan,
          tetap pakai "Kirim via Admin" (omniSendRequest, sudah ada di halaman lain).
       🏢 Internal — chat native Directus (internal_chat_rooms/messages), balas di room yang
          sudah dibuat rekan/admin. Mulai chat baru dari lapangan BELUM didukung — project-epi
          belum punya direktori Firebase UID rekan kerja yang bisa dipetakan dari sisi klien
          (karyawan.ts tidak menyimpan uid), jadi PL bisa membalas tapi belum memulai chat baru
          sendiri dari sini. Mulai chat baru tetap bisa dari sisi admin (erp-epi-1). -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { auth } from '$lib/firebase';
	import { authStore } from '$lib/stores/auth';
	import { getMyLinkedConversations, getConversationMessagesReadOnly, type ReadOnlyConversation, type ReadOnlyMessage } from '$lib/services/omniReadOnlyApi';
	import { getMyRooms, getRoomMessages, sendMessage, markRoomAsRead, roomDisplayName, type ChatRoom, type ChatMessage } from '$lib/services/internalChatApi';
	import { getProjectsForCurrentUser } from '$lib/services/projectScope';
	import { uploadQuickUpdatePhoto, createQuickUpdate, generateCaptionFromPhoto } from '$lib/services/quickUpdateApi';
	import { compressImageFile } from '$lib/utils/photoWatermark';
	import {
		enqueueInternalChatMessage,
		getQueuedInternalChatMessages,
		flushInternalChatQueue,
		registerInternalChatAutoFlush
	} from '$lib/utils/offlineInternalChatQueue';
	import { getLedProjects, getActiveEquipmentIds, getPlKpi, type PlKpi } from '$lib/services/plDashboard';
	import directus from '$lib/services/directus';
	import { createItem } from '@directus/sdk';

	let open = $state(false);
	let tab = $state<'omni' | 'internal' | 'update'>('update');

	const myUid = $derived($authStore.user?.uid || null);
	const myName = $derived($authStore.user?.displayName || $authStore.karyawanName || 'Karyawan');

	// ── Omnichannel read-only ───────────────────────────────────────────
	let convs = $state<ReadOnlyConversation[]>([]);
	let loadingConvs = $state(true);
	let selectedConv = $state<ReadOnlyConversation | null>(null);
	let convMessages = $state<ReadOnlyMessage[]>([]);
	let loadingConvMsgs = $state(false);

	async function loadConvs() {
		loadingConvs = true;
		convs = await getMyLinkedConversations();
		loadingConvs = false;
	}

	async function openConv(c: ReadOnlyConversation) {
		selectedConv = c;
		loadingConvMsgs = true;
		convMessages = await getConversationMessagesReadOnly(c.id);
		loadingConvMsgs = false;
	}

	// ── Chat internal ────────────────────────────────────────────────────
	let rooms = $state<ChatRoom[]>([]);
	let loadingRooms = $state(true);
	let selectedRoom = $state<ChatRoom | null>(null);
	let roomMessages = $state<ChatMessage[]>([]);
	let loadingRoomMsgs = $state(false);
	let composerText = $state('');
	let sendingRoom = $state(false);
	let scrollEl: HTMLDivElement | undefined = $state();

	async function loadRooms() {
		loadingRooms = true;
		rooms = await getMyRooms(myUid);
		loadingRooms = false;
	}

	async function openRoom(r: ChatRoom) {
		selectedRoom = r;
		loadingRoomMsgs = true;
		roomMessages = await getRoomMessages(r.id);
		loadingRoomMsgs = false;
		markRoomAsRead(r.id, myUid);
		queueMicrotask(() => { if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight; });
	}

	// Fase 5 (Rekomendasi #5 Lapangan) — Offline Chat Queue: kalau kirim gagal karena
	// jaringan (bukan ditolak server), simpan lokal & auto-kirim saat online kembali.
	let queuedChatCount = $state(0);
	async function refreshQueuedChatCount() {
		queuedChatCount = (await getQueuedInternalChatMessages()).length;
	}
	async function sendQueuedEntry(entry: { roomId: number; senderUid: string; senderName: string; content: string }) {
		const ok = await sendMessage(entry.roomId, entry.senderUid, entry.senderName, entry.content);
		if (!ok) throw new Error('gagal kirim');
	}
	let flushingChatQueue = $state(false);
	async function flushChatQueueNow() {
		if (flushingChatQueue) return;
		flushingChatQueue = true;
		await flushInternalChatQueue(sendQueuedEntry);
		flushingChatQueue = false;
		await refreshQueuedChatCount();
		if (selectedRoom) roomMessages = await getRoomMessages(selectedRoom.id);
	}
	registerInternalChatAutoFlush(sendQueuedEntry);
	refreshQueuedChatCount();

	async function sendToRoom() {
		const text = composerText.trim();
		if (!text || !selectedRoom || !myUid || sendingRoom) return;
		composerText = '';
		sendingRoom = true;
		try {
			const ok = await sendMessage(selectedRoom.id, myUid, myName, text);
			if (ok) {
				roomMessages = await getRoomMessages(selectedRoom.id);
				queueMicrotask(() => { if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight; });
				loadRooms();
			}
		} catch (e: any) {
			const isNetworkError = e instanceof TypeError || (typeof navigator !== 'undefined' && !navigator.onLine);
			if (isNetworkError && selectedRoom) {
				await enqueueInternalChatMessage({
					client_txn_id: crypto.randomUUID(),
					roomId: selectedRoom.id,
					senderUid: myUid,
					senderName: myName,
					content: text,
					createdAt: new Date().toISOString()
				});
				await refreshQueuedChatCount();
			}
		} finally {
			sendingRoom = false;
		}
	}

	// ── Update Cepat (Rekomendasi #1+#2 Lapangan) ───────────────────────
	let myProjects = $state<any[]>([]);
	let loadingProjects = $state(true);
	let selectedProjectId = $state<number | null>(null);
	let updateText = $state('');
	let updatePhoto = $state<File | null>(null);
	let updatePhotoPreview = $state('');
	let updatePhotoInput: HTMLInputElement | undefined = $state();
	let generatingCaption = $state(false);
	let submittingUpdate = $state(false);
	let updateSentMessage = $state('');
	let aiGeneratedFlag = $state(false);

	async function loadMyProjects() {
		loadingProjects = true;
		myProjects = await getProjectsForCurrentUser(true);
		if (myProjects.length && !selectedProjectId) selectedProjectId = myProjects[0].id;
		loadingProjects = false;
	}

	function fileToBase64(file: File): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
			reader.onerror = () => reject(reader.error);
			reader.readAsDataURL(file);
		});
	}

	async function onUpdatePhotoPicked(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		aiGeneratedFlag = false;
		updateSentMessage = '';
		const compressed = await compressImageFile(file);
		updatePhoto = compressed;
		updatePhotoPreview = URL.createObjectURL(compressed);
	}

	function removeUpdatePhoto() {
		updatePhoto = null;
		updatePhotoPreview = '';
		aiGeneratedFlag = false;
	}

	async function generateCaption() {
		if (!updatePhoto || generatingCaption) return;
		generatingCaption = true;
		try {
			const base64 = await fileToBase64(updatePhoto);
			const projectName = myProjects.find((p) => p.id === selectedProjectId)?.name || 'proyek ini';
			const caption = await generateCaptionFromPhoto(base64, updatePhoto.type || 'image/jpeg', updatePhoto.name || 'foto.jpg', projectName);
			if (caption) {
				updateText = caption;
				aiGeneratedFlag = true;
			}
		} finally {
			generatingCaption = false;
		}
	}

	// Fase 5 (Rekomendasi #4 Lapangan) — Voice-to-Text: dikte teks update lewat Web
	// Speech API (gratis/klien, sama seperti pola di AsistenSheet.svelte). Dukungan
	// browser bervariasi (Android Chrome baik, iOS Safari terbatas) — tombol
	// disembunyikan total kalau API tidak ada.
	let voiceSupported = $state(false);
	let listening = $state(false);
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
			if (transcript) {
				updateText = updateText ? `${updateText} ${transcript}` : transcript;
				aiGeneratedFlag = false;
			}
		};
		recognition.onerror = () => { listening = false; };
		recognition.onend = () => { listening = false; };
	}
	initVoice();

	function toggleVoice() {
		if (!recognition) return;
		if (listening) {
			recognition.stop();
			listening = false;
			return;
		}
		try {
			recognition.start();
			listening = true;
		} catch { /* start() dobel-panggil — abaikan */ }
	}

	// Fase 5 (Rekomendasi #6 Lapangan) — Escalation Button: kirim alert prioritas
	// tinggi ke manajemen (app_notifications, dept 'project') dengan konteks proyek.
	let showEscalation = $state(false);
	let escalationText = $state('');
	let sendingEscalation = $state(false);
	let escalationSentMessage = $state('');

	async function sendEscalation() {
		if (!escalationText.trim() || !selectedProjectId || sendingEscalation) return;
		sendingEscalation = true;
		try {
			const projectName = myProjects.find((p) => p.id === selectedProjectId)?.name || 'Proyek';
			await directus.request(
				createItem('app_notifications', {
					type: 'field_escalation',
					title: `🆘 Eskalasi dari ${myName} — ${projectName}`,
					message: escalationText.trim(),
					priority: 'high',
					department: 'project',
					read: false,
					action_required: true,
					action_url: `/laporan/${selectedProjectId}`,
					action_text: 'Buka Proyek',
					created_at: new Date().toISOString()
				})
			);
			escalationSentMessage = 'Eskalasi terkirim ke manajemen ✓';
			escalationText = '';
			setTimeout(() => { showEscalation = false; escalationSentMessage = ''; }, 1800);
		} catch {
			escalationSentMessage = 'Gagal mengirim eskalasi — coba lagi.';
		} finally {
			sendingEscalation = false;
		}
	}

	async function submitQuickUpdate() {
		if (!selectedProjectId || !updateText.trim() || submittingUpdate) return;
		submittingUpdate = true;
		updateSentMessage = '';
		try {
			let photoFileId: string | null = null;
			if (updatePhoto) photoFileId = await uploadQuickUpdatePhoto(updatePhoto);
			const s = $authStore;
			const ok = await createQuickUpdate({
				projectId: selectedProjectId,
				authorUid: myUid,
				authorName: myName,
				karyawanId: s.karyawanId,
				text: updateText.trim(),
				aiGenerated: aiGeneratedFlag,
				photoFileId
			});
			if (ok) {
				updateSentMessage = 'Update terkirim ✓';
				updateText = '';
				removeUpdatePhoto();
			} else {
				updateSentMessage = 'Gagal mengirim update — coba lagi.';
			}
		} finally {
			submittingUpdate = false;
		}
	}

	// ── Status Board Mini (Rekomendasi #3 Lapangan) ─────────────────────
	let statusKpi = $state<PlKpi | null>(null);
	let statusLedProjectCount = $state(0);
	let loadingStatus = $state(false);
	let statusLoadedOnce = false;

	async function loadStatusBoard() {
		if (statusLoadedOnce) return;
		statusLoadedOnce = true;
		loadingStatus = true;
		try {
			const s = $authStore;
			const led = await getLedProjects(s.karyawanId, s.karyawanName);
			statusLedProjectCount = led.length;
			const equipmentIds = await getActiveEquipmentIds(led.map((p) => p.id));
			statusKpi = await getPlKpi(equipmentIds);
		} finally {
			loadingStatus = false;
		}
	}

	function toggle() {
		open = !open;
		if (open) {
			selectedConv = null;
			selectedRoom = null;
			loadStatusBoard();
			if (tab === 'internal' && !rooms.length) loadRooms();
			else if (tab === 'omni' && !convs.length) loadConvs();
			else if (tab === 'update' && !myProjects.length) loadMyProjects();
		}
	}

	function selectTab(t: 'omni' | 'internal' | 'update') {
		tab = t;
		selectedConv = null;
		selectedRoom = null;
		if (t === 'internal' && !rooms.length) loadRooms();
		else if (t === 'omni' && !convs.length) loadConvs();
		else if (t === 'update' && !myProjects.length) loadMyProjects();
	}
</script>

<button
	type="button"
	onclick={toggle}
	class="fixed bottom-40 right-4 lg:bottom-24 z-[9985] w-12 h-12 rounded-full bg-violet-600 hover:bg-violet-700 text-white shadow-2xl flex items-center justify-center text-xl focus:outline-none focus:ring-4 focus:ring-violet-300 transition-transform hover:scale-105"
	aria-label={open ? 'Tutup Pusat Komunikasi' : 'Buka Pusat Komunikasi'}
	title="Pusat Komunikasi"
>
	{open ? '✕' : '💬'}
</button>

{#if open}
	<div class="fixed inset-0 z-[9984] bg-black/30" onclick={toggle} aria-hidden="true"></div>
	<div class="fixed left-0 right-0 bottom-0 z-[9985] bg-white rounded-t-2xl shadow-2xl flex flex-col overflow-hidden" style="height: min(75vh, 640px);">
		<div class="px-4 py-3 bg-violet-600 text-white flex items-center gap-3 shrink-0">
			<div class="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center text-lg">💬</div>
			<div class="flex-1 min-w-0">
				<div class="font-semibold leading-tight">Pusat Komunikasi</div>
				<div class="text-xs text-violet-100">Omnichannel &amp; Chat Tim</div>
			</div>
			<button type="button" onclick={toggle} class="text-violet-100 hover:text-white text-xl leading-none px-1" aria-label="Tutup">✕</button>
		</div>

		<!-- Status Board Mini (Rekomendasi #3 Lapangan) — hanya tampil untuk PL yang memimpin proyek -->
		{#if !loadingStatus && statusLedProjectCount > 0 && statusKpi}
			<div class="px-3 py-2 bg-violet-50 border-b border-violet-100 flex items-center justify-around text-center shrink-0" title="Ringkasan status equipment di proyek yang Anda pimpin">
				<div>
					<div class="text-sm font-bold text-violet-800">{statusLedProjectCount}</div>
					<div class="text-[9px] text-violet-600">Proyek</div>
				</div>
				<div>
					<div class="text-sm font-bold {statusKpi.woOpen > 0 ? 'text-amber-700' : 'text-violet-800'}">{statusKpi.woOpen}</div>
					<div class="text-[9px] text-violet-600">WO Terbuka</div>
				</div>
				<div>
					<div class="text-sm font-bold {statusKpi.pmOverdue > 0 ? 'text-rose-700' : 'text-violet-800'}">{statusKpi.pmOverdue}</div>
					<div class="text-[9px] text-violet-600">PM Lewat Jadwal</div>
				</div>
				<div>
					<div class="text-sm font-bold text-violet-800">{statusKpi.p2hDone}/{statusKpi.p2hEquipmentCount}</div>
					<div class="text-[9px] text-violet-600">P2H Hari Ini</div>
				</div>
			</div>
		{/if}

		<div class="flex items-center border-b border-gray-200 shrink-0 text-xs">
			<button type="button" class="flex-1 py-2.5 font-medium border-b-2 {tab === 'update' ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-500'}" onclick={() => selectTab('update')}>
				⚡ Update
			</button>
			<button type="button" class="flex-1 py-2.5 font-medium border-b-2 {tab === 'internal' ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-500'}" onclick={() => selectTab('internal')}>
				🏢 Chat Tim
			</button>
			<button type="button" class="flex-1 py-2.5 font-medium border-b-2 {tab === 'omni' ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-500'}" onclick={() => selectTab('omni')}>
				💬 Omnichannel
			</button>
		</div>

		{#if queuedChatCount > 0}
			<div class="px-3 py-1.5 bg-blue-50 border-b border-blue-100 flex items-center justify-between text-xs text-blue-700 shrink-0">
				<span>📴 {queuedChatCount} pesan menunggu koneksi</span>
				<button type="button" onclick={flushChatQueueNow} disabled={flushingChatQueue} class="text-blue-600 hover:underline disabled:opacity-50">
					{flushingChatQueue ? 'Mengirim…' : 'Kirim sekarang'}
				</button>
			</div>
		{/if}
		{#if tab === 'update'}
			<div class="flex-1 overflow-y-auto p-3 space-y-3">
				{#if loadingProjects}
					<CircularProgressGauge size={44} strokeWidth={3} label="Memuat proyek…" />
				{:else if !myProjects.length}
					<p class="text-xs text-gray-400 text-center py-8 px-4">Anda belum punya proyek aktif untuk dikirimi update.</p>
				{:else}
					<div class="flex items-end gap-2">
						<label class="block flex-1">
							<span class="text-[11px] text-gray-500">Proyek</span>
							<select bind:value={selectedProjectId} class="w-full mt-0.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm">
								{#each myProjects as p (p.id)}
									<option value={p.id}>{p.name}</option>
								{/each}
							</select>
						</label>
						<button type="button" onclick={() => (showEscalation = true)} class="shrink-0 rounded-lg border border-rose-200 text-rose-700 px-3 py-1.5 text-xs font-medium hover:bg-rose-50" title="Kirim alert prioritas tinggi ke manajemen (dipakai untuk kendala mendesak)">
							🆘 Eskalasi
						</button>
					</div>

					{#if showEscalation}
						<div class="rounded-lg border border-rose-200 bg-rose-50 p-2.5 space-y-2">
							<p class="text-[11px] font-semibold text-rose-800">Eskalasi ke manajemen — hanya untuk kendala mendesak yang butuh perhatian segera.</p>
							<textarea bind:value={escalationText} rows="3" placeholder="Jelaskan kendala yang perlu eskalasi…" class="w-full rounded-lg border border-rose-200 px-2.5 py-1.5 text-sm resize-none"></textarea>
							{#if escalationSentMessage}
								<p class="text-xs {escalationSentMessage.startsWith('Gagal') ? 'text-rose-700' : 'text-emerald-700'}">{escalationSentMessage}</p>
							{/if}
							<div class="flex gap-2">
								<button type="button" onclick={sendEscalation} disabled={sendingEscalation || !escalationText.trim()} class="flex-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white py-1.5 text-xs font-semibold disabled:opacity-40">
									{sendingEscalation ? 'Mengirim…' : 'Kirim Eskalasi'}
								</button>
								<button type="button" onclick={() => { showEscalation = false; escalationText = ''; }} class="rounded-lg border border-gray-200 px-3 text-xs text-gray-600 hover:bg-gray-50">Batal</button>
							</div>
						</div>
					{/if}

					<div>
						<span class="text-[11px] text-gray-500">Foto (opsional)</span>
						<input bind:this={updatePhotoInput} type="file" accept="image/*" capture="environment" class="hidden" onchange={onUpdatePhotoPicked} />
						{#if updatePhotoPreview}
							<div class="relative mt-1 w-fit">
								<img src={updatePhotoPreview} alt="Foto update" class="max-h-32 rounded-lg border border-gray-200 object-cover" />
								<button type="button" onclick={removeUpdatePhoto} class="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-gray-700 text-white flex items-center justify-center text-[10px]" aria-label="Hapus foto">✕</button>
							</div>
							<button type="button" onclick={generateCaption} disabled={generatingCaption} class="mt-2 w-full rounded-lg border border-violet-200 text-violet-700 py-1.5 text-xs font-medium hover:bg-violet-50 disabled:opacity-50">
								{generatingCaption ? '✨ AI sedang menulis…' : '✨ AI: Buat narasi dari foto ini'}
							</button>
						{:else}
							<button type="button" onclick={() => updatePhotoInput?.click()} class="mt-1 w-full rounded-lg border border-dashed border-gray-300 py-3 text-xs text-gray-500 hover:bg-gray-50">
								📷 Ambil/pilih foto
							</button>
						{/if}
					</div>

					<label class="block">
						<div class="flex items-center justify-between">
							<span class="text-[11px] text-gray-500">Catatan update {#if aiGeneratedFlag}<span class="text-violet-600">(disusun AI — silakan sunting)</span>{/if}</span>
							{#if voiceSupported}
								<button type="button" onclick={toggleVoice} class="text-[11px] font-medium {listening ? 'text-rose-600' : 'text-violet-700'} hover:underline" title="Dikte teks pakai suara">
									{listening ? '⏹️ Berhenti' : '🎤 Dikte'}
								</button>
							{/if}
						</div>
						<textarea
							bind:value={updateText}
							oninput={() => (aiGeneratedFlag = false)}
							rows="4"
							placeholder="Ketik progres hari ini, lampirkan foto lalu tekan tombol AI, atau dikte pakai suara…"
							class="w-full mt-0.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm resize-none {listening ? 'border-rose-300 ring-2 ring-rose-100' : ''}"
						></textarea>
					</label>

					{#if updateSentMessage}
						<p class="text-xs {updateSentMessage.startsWith('Gagal') ? 'text-rose-600' : 'text-emerald-600'}">{updateSentMessage}</p>
					{/if}

					<button type="button" onclick={submitQuickUpdate} disabled={submittingUpdate || !updateText.trim() || !selectedProjectId} class="w-full rounded-lg bg-violet-600 hover:bg-violet-700 text-white py-2 text-sm font-medium disabled:opacity-40">
						{submittingUpdate ? 'Mengirim…' : 'Kirim Update'}
					</button>
					<p class="text-[10px] text-gray-400 text-center">Update cepat ini terpisah dari Laporan Harian resmi — untuk laporan lengkap tetap isi form Laporan Harian di halaman proyek.</p>
				{/if}
			</div>
		{:else if tab === 'internal'}
			{#if selectedRoom}
				<div class="flex items-center gap-2 px-3 py-2 border-b border-gray-200 shrink-0">
					<button type="button" onclick={() => (selectedRoom = null)} class="text-sm text-violet-600 hover:underline shrink-0">← Kembali</button>
					<span class="text-xs text-gray-500 truncate font-medium">{roomDisplayName(selectedRoom, myUid)}</span>
				</div>
				<div bind:this={scrollEl} class="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-gray-50">
					{#if loadingRoomMsgs}
						<p class="text-xs text-gray-400 text-center py-6">Memuat…</p>
					{:else if !roomMessages.length}
						<p class="text-xs text-gray-400 text-center py-6">Belum ada pesan.</p>
					{:else}
						{#each roomMessages as m (m.id)}
							<div class="flex {m.sender_uid === myUid ? 'justify-end' : 'justify-start'}">
								<div class="max-w-[80%] rounded-2xl px-3 py-1.5 text-sm {m.sender_uid === myUid ? 'bg-violet-600 text-white rounded-br-sm' : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm'}">
									{#if m.sender_uid !== myUid}<div class="text-[10px] font-semibold text-gray-400 mb-0.5">{m.sender_name}</div>{/if}
									<div class="whitespace-pre-wrap break-words">{m.content}</div>
								</div>
							</div>
						{/each}
					{/if}
				</div>
				<div class="p-2.5 border-t border-gray-200 bg-white shrink-0 flex items-end gap-2">
					<textarea
						bind:value={composerText}
						onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendToRoom(); } }}
						rows="1"
						placeholder="Ketik pesan…"
						class="flex-1 resize-none rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
					></textarea>
					<button type="button" onclick={sendToRoom} disabled={sendingRoom || !composerText.trim()} class="w-9 h-9 shrink-0 rounded-full bg-violet-600 hover:bg-violet-700 text-white flex items-center justify-center disabled:opacity-40" aria-label="Kirim">➤</button>
				</div>
			{:else}
				<div class="flex-1 overflow-y-auto">
					{#if loadingRooms}
						<p class="text-xs text-gray-400 text-center py-8">Memuat…</p>
					{:else if !rooms.length}
						<div class="text-xs text-gray-400 text-center py-8 px-4">Belum ada percakapan tim. Rekan/admin bisa memulai chat dengan Anda dari dashboard admin.</div>
					{:else}
						<ul class="divide-y divide-gray-50">
							{#each rooms as r (r.id)}
								<li>
									<button type="button" class="w-full text-left px-3 py-2.5 hover:bg-gray-50" onclick={() => openRoom(r)}>
										<div class="text-sm font-medium text-gray-800 truncate">{roomDisplayName(r, myUid)}</div>
										<p class="text-[11px] text-gray-500 truncate mt-0.5">{r.last_message_preview || 'Belum ada pesan'}</p>
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/if}
		{:else}
			{#if selectedConv}
				<div class="flex items-center gap-2 px-3 py-2 border-b border-gray-200 shrink-0">
					<button type="button" onclick={() => (selectedConv = null)} class="text-sm text-violet-600 hover:underline shrink-0">← Kembali</button>
					<span class="text-xs text-gray-400 truncate">{selectedConv.contact?.name || selectedConv.contact?.phone || 'Percakapan'} (lihat saja)</span>
				</div>
				<div class="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-gray-50">
					{#if loadingConvMsgs}
						<p class="text-xs text-gray-400 text-center py-6">Memuat…</p>
					{:else if !convMessages.length}
						<p class="text-xs text-gray-400 text-center py-6">Belum ada pesan.</p>
					{:else}
						{#each convMessages as m (m.id)}
							<div class="flex {m.direction === 'out' ? 'justify-end' : 'justify-start'}">
								<div class="max-w-[80%] rounded-2xl px-3 py-1.5 text-sm {m.direction === 'out' ? 'bg-violet-100 text-gray-800 rounded-br-sm' : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm'}">
									<div class="whitespace-pre-wrap break-words">{m.text}</div>
								</div>
							</div>
						{/each}
					{/if}
				</div>
				<div class="p-2.5 border-t border-gray-200 bg-amber-50 shrink-0 text-[11px] text-amber-800 text-center">
					📋 Hanya lihat. Untuk membalas, gunakan "Kirim via Admin" di halaman proyek.
				</div>
			{:else}
				<div class="flex-1 overflow-y-auto">
					{#if loadingConvs}
						<p class="text-xs text-gray-400 text-center py-8">Memuat…</p>
					{:else if !convs.length}
						<div class="text-xs text-gray-400 text-center py-8 px-4">Belum ada percakapan omnichannel yang terkait proyek Anda.</div>
					{:else}
						<ul class="divide-y divide-gray-50">
							{#each convs as c (c.id)}
								<li>
									<button type="button" class="w-full text-left px-3 py-2.5 hover:bg-gray-50" onclick={() => openConv(c)}>
										<div class="text-sm font-medium text-gray-800 truncate">{c.contact?.name || c.contact?.phone || 'Tanpa nama'}</div>
										<p class="text-[11px] text-gray-500 truncate mt-0.5">{c.last_message_preview || '—'}</p>
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/if}
		{/if}
	</div>
{/if}
