<!-- src/lib/components/proyek/PersiapanLeaderPanel.svelte -->
<!-- Kickoff Wizard v2 — Fase 4. Porsi Project Leader dari checklist persiapan proyek. -->
<!-- Item ber-owner 'leader'/'both' bisa dicentang & diberi bukti foto dari sini; item -->
<!-- porsi kantor tampil read-only ("ditunggu dari kantor"). Menulis ke koleksi -->
<!-- project_readiness_checks yang SAMA dengan admin (satu sumber kebenaran). -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import {
		getPersiapanChecklist,
		setReadinessCheck,
		type LeaderChecklistItem
	} from '$lib/services/projectSiteSurvey';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import { uploadEvidencePhoto } from '$lib/services/stockLapangan';
	import { IconLoader2, IconCamera, IconChevronRight } from '@tabler/icons-svelte';
	import { goto } from '$app/navigation';
	import { getIdToken } from '$lib/services/secureDirectus';

	let { projectId, onStarted }: { projectId: number | string; onStarted?: () => void } = $props();
	const pid = $derived(Number(projectId));

	let loading = $state(true);
	let error = $state('');
	let leaderItems = $state<LeaderChecklistItem[]>([]);
	let officeItems = $state<LeaderChecklistItem[]>([]);
	let busyItem = $state<string | null>(null);
	let offlineNote = $state(false);

	const STEP_LABEL: Record<string, string> = {
		L1: 'L1 · Data Dasar', L2: 'L2 · Charter & RAB', L3: 'L3 · Teknis & Objek',
		L4: 'L4 · HSE & Perizinan', L5: 'L5 · Mobilisasi & Tim', L6: 'L6 · Kick-Off'
	};

	let wajib = $derived(leaderItems.filter((i) => i.wajib));
	let wajibDone = $derived(wajib.filter((i) => i.checked).length);
	let myPct = $derived(wajib.length ? Math.round((wajibDone / wajib.length) * 100) : 100);
	let stepsOfLeader = $derived([...new Set(leaderItems.map((i) => i.langkah))].sort());

	function pendingKey() {
		return `persiapan_pending_${pid}`;
	}
	function queueOffline(itemId: string, checked: boolean) {
		try {
			const cur = JSON.parse(localStorage.getItem(pendingKey()) || '[]');
			const next = cur.filter((x: any) => x.itemId !== itemId);
			next.push({ itemId, checked });
			localStorage.setItem(pendingKey(), JSON.stringify(next));
		} catch {
			/* best-effort */
		}
	}
	async function flushOffline() {
		let cur: any[] = [];
		try {
			cur = JSON.parse(localStorage.getItem(pendingKey()) || '[]');
		} catch {
			cur = [];
		}
		if (!cur.length) return;
		const actor = $authStore.karyawanName || 'lapangan';
		const done: string[] = [];
		for (const x of cur) {
			try {
				await setReadinessCheck(pid, x.itemId, x.checked, actor);
				done.push(x.itemId);
			} catch {
				/* biarkan tersisa di antrean, coba lagi nanti */
			}
		}
		try {
			const left = cur.filter((x) => !done.includes(x.itemId));
			localStorage.setItem(pendingKey(), JSON.stringify(left));
		} catch {
			/* ignore */
		}
		if (done.length) await load();
	}

	// Fase 4 — Kickoff Lapangan: "Mulai Bekerja" → status On Progress. Tidak terkunci oleh kesiapan; kekurangan dicatat sebagai override.
	let kickoffBusy = $state(false);
	let kickoffMsg = $state('');
	async function kickoffCall(method: 'GET' | 'POST') {
		const token = await getIdToken();
		const url = '/api/proyek/kickoff-lapangan' + (method === 'GET' ? '?projectId=' + pid : '');
		const res = await fetch(url, {
			method,
			headers: { Authorization: 'Bearer ' + token, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
			body: method === 'POST' ? JSON.stringify({ projectId: pid }) : undefined
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(data?.message || 'Gagal (HTTP ' + res.status + ')');
		return data;
	}
	async function mulaiBekerja() {
		if (!navigator.onLine) {
			error = 'Mulai Bekerja butuh koneksi. Coba lagi saat online.';
			return;
		}
		kickoffBusy = true;
		kickoffMsg = '';
		try {
			const pre = await kickoffCall('GET');
			const failed: string[] = pre.failed || [];
			const ok = confirm(
				failed.length
					? 'Kesiapan proyek belum lengkap:\n• ' + failed.join('\n• ') + '\n\nAnda tetap bisa memulai. Kekurangan ini akan DICATAT sebagai override (bukan dikunci). Mulai bekerja sekarang?'
					: 'Mulai bekerja di lokasi sekarang? Status proyek menjadi On Progress dan tanggal mulai dicatat hari ini.'
			);
			if (!ok) return;
			await kickoffCall('POST');
			kickoffMsg = 'Proyek dimulai — status On Progress. Silakan isi laporan harian pertama.';
			onStarted?.();
		} catch (e: any) {
			error = e?.message || 'Gagal memulai proyek.';
		} finally {
			kickoffBusy = false;
		}
	}

	async function load() {
		loading = true;
		error = '';
		try {
			const res = await getPersiapanChecklist(pid);
			leaderItems = res.leaderItems;
			officeItems = res.officeItems;
		} catch (e: any) {
			error = e?.message || 'Gagal memuat checklist persiapan.';
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		load().then(flushOffline);
		const onOnline = () => flushOffline();
		window.addEventListener('online', onOnline);
		return () => window.removeEventListener('online', onOnline);
	});

	async function toggle(item: LeaderChecklistItem, checked: boolean) {
		if (!navigator.onLine) {
			queueOffline(item.id, checked);
			leaderItems = leaderItems.map((i) => (i.id === item.id ? { ...i, checked } : i));
			offlineNote = true;
			return;
		}
		busyItem = item.id;
		try {
			await setReadinessCheck(pid, item.id, checked, $authStore.karyawanName || 'lapangan');
			leaderItems = leaderItems.map((i) => (i.id === item.id ? { ...i, checked } : i));
		} catch (e: any) {
			error = e?.message || 'Gagal menyimpan.';
		} finally {
			busyItem = null;
		}
	}

	async function onPhoto(item: LeaderChecklistItem, e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		if (!navigator.onLine) {
			error = 'Foto perlu koneksi. Coba lagi saat online.';
			return;
		}
		busyItem = item.id;
		try {
			const compressed = await compressPhoto(file);
			const fileId = await uploadEvidencePhoto(compressed, `readiness:${item.id}`);
			await setReadinessCheck(pid, item.id, true, $authStore.karyawanName || 'lapangan', fileId);
			leaderItems = leaderItems.map((i) =>
				i.id === item.id ? { ...i, checked: true, evidenceFileId: fileId } : i
			);
		} catch (err: any) {
			error = err?.message || 'Gagal mengunggah foto.';
		} finally {
			busyItem = null;
			input.value = '';
		}
	}
</script>

<div class="flex flex-col gap-3 px-4 py-4">
	<!-- Hint permanen -->
	<div class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-800">
		<b>Selesaikan langkah ini sebelum tim berangkat.</b> Tanpa persiapan lengkap, pengajuan
		anggaran proyek &amp; kenaikan status proyek dapat tertahan. Anda hanya mengisi item yang jadi
		porsi lapangan — item kantor ditangani admin.
	</div>

	<!-- Fase 4: Mulai Bekerja (Kickoff Lapangan) -->
	<div class="rounded-xl border p-3" style="border-color: var(--g); background: var(--gl)">
		<p class="text-[13px] font-bold" style="color: var(--gd)">▶️ Mulai Bekerja di Lokasi</p>
		<p class="mt-1 text-[11px]" style="color: var(--sys-label3)">
			Tekan saat tim sudah tiba dan mulai mengerjakan. Status proyek jadi <b>On Progress</b> dan tanggal mulai tercatat.
			Persiapan yang belum lengkap <b>tidak menghalangi</b> — hanya dicatat agar admin menyusul.
		</p>
		{#if kickoffMsg}
			<p class="mt-2 text-[12px] font-semibold" style="color: var(--g)">✅ {kickoffMsg}</p>
		{:else}
			<button
				class="mt-2 w-full rounded-lg px-3 py-2.5 text-[13px] font-bold text-white disabled:opacity-60"
				style="background: var(--g)"
				disabled={kickoffBusy}
				onclick={mulaiBekerja}
			>
				{kickoffBusy ? 'Memproses…' : 'Mulai Bekerja'}
			</button>
		{/if}
	</div>

	{#if loading}
		<CircularProgressGauge size={48} strokeWidth={4} label="Memuat checklist persiapan leader..." />
	{:else if error}
		<div class="rounded-lg border border-red-200 bg-red-50 p-3 text-[12px] text-red-700">{error}</div>
	{:else}
		<!-- Progress porsi saya -->
		<div class="rounded-xl border p-3" style="border-color: var(--sys-border); background: var(--sys-bg2)">
			<div class="flex items-center justify-between text-[12px] font-semibold" style="color: var(--sys-label)">
				<span>Porsi Saya</span>
				<span>{wajibDone}/{wajib.length} wajib · {myPct}%</span>
			</div>
			<div class="mt-2 h-2 w-full overflow-hidden rounded-full" style="background: var(--sys-fill2)">
				<div class="h-full transition-all" style="width: {myPct}%; background: {myPct >= 100 ? '#16a34a' : myPct >= 60 ? '#d97706' : '#dc2626'}"></div>
			</div>
		</div>

		<!-- Checklist Leader per langkah -->
		{#each stepsOfLeader as step (step)}
			<div class="rounded-xl border" style="border-color: var(--sys-border); background: var(--sys-bg2)">
				<div class="border-b px-3 py-2 text-[12px] font-bold" style="border-color: var(--sys-border); color: var(--sys-label)">
					{STEP_LABEL[step] || step}
				</div>
				<div class="divide-y" style="border-color: var(--sys-border)">
					{#each leaderItems.filter((i) => i.langkah === step) as item (item.id)}
						<div class="flex items-center justify-between gap-3 px-3 py-2.5">
							<div class="min-w-0">
								<p class="text-[13px] font-medium" style="color: var(--sys-label)">
									{item.checked ? '✅' : '⬜'} {item.label}
									{#if item.wajib}<span class="ml-1 text-[10px] text-red-500">wajib</span>{/if}
								</p>
								<p class="text-[10px]" style="color: var(--sys-label4)">
									{#if item.owner === 'both'}Bersama admin/HSE{:else}Porsi lapangan{/if}
									{#if item.checkedBy}· oleh {item.checkedBy}{/if}
									{#if item.evidenceFileId}· 📷 bukti terlampir{/if}
								</p>
							</div>
							<div class="flex shrink-0 items-center gap-1.5">
								{#if item.source === 'auto'}
									<span class="text-[10px]" style="color: var(--sys-label4)">otomatis</span>
								{:else if item.bukti === 'foto'}
									<label class="flex cursor-pointer items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold" style="border-color: var(--sys-border); color: var(--sys-label3)">
										<IconCamera size={14} /> {item.evidenceFileId ? 'Ganti' : 'Foto'}
										<input type="file" accept="image/*" capture="environment" class="hidden" disabled={busyItem === item.id} onchange={(e) => onPhoto(item, e)} />
									</label>
								{:else}
									<input
										type="checkbox"
										class="h-5 w-5"
										checked={item.checked}
										disabled={busyItem === item.id}
										onchange={(e) => toggle(item, (e.target as HTMLInputElement).checked)}
									/>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/each}

		<!-- Site survey terpisah (form lengkap sudah ada) -->
		<button
			class="flex items-center justify-between rounded-xl border px-3 py-3 text-left"
			style="border-color: var(--sys-border); background: var(--sys-bg2)"
			onclick={() => goto(`/proyek/${projectId}/site-survey`)}
		>
			<div>
				<p class="text-[13px] font-semibold" style="color: var(--sys-label)">📍 Site Survey &amp; Mobilisasi</p>
				<p class="text-[11px]" style="color: var(--sys-label4)">Form kondisi lokasi + checklist mobilisasi (APD, izin kerja, alat)</p>
			</div>
			<IconChevronRight size={16} style="color: var(--sys-label4)" />
		</button>

		<!-- Ditunggu dari kantor -->
		{#if officeItems.length}
			<div class="rounded-xl border p-3" style="border-color: var(--sys-border); background: var(--sys-bg2)">
				<p class="mb-2 text-[12px] font-bold" style="color: var(--sys-label3)">Ditunggu dari kantor (read-only)</p>
				<div class="flex flex-col gap-1">
					{#each officeItems as item (item.id)}
						<p class="text-[11px]" style="color: var(--sys-label4)">
							{item.checked ? '✅' : '⏳'} {item.label}
						</p>
					{/each}
				</div>
				<p class="mt-2 text-[10px]" style="color: var(--sys-label4)">
					Kalau ini yang menahan, bukan Anda — hubungi admin proyek.
				</p>
			</div>
		{/if}

		{#if offlineNote}
			<div class="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-700">
				📴 Perubahan tersimpan di perangkat &amp; akan terkirim otomatis saat online.
			</div>
		{/if}
	{/if}
</div>
