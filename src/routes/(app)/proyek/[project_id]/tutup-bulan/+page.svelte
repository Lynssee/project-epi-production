<!-- src/routes/(app)/proyek/[project_id]/tutup-bulan/+page.svelte -->
<!-- Tutup Bulan (Laporan Bulanan Terpadu): Project Leader memeriksa kelengkapan laporan harian, menulis narasi bulanan, memilih foto terbaik, lalu
     menutup bulan. Narasi + foto dipakai admin pada dokumen cetak "Laporan Bulanan Terpadu" (erp-epi). Penutupan TIDAK diblokir kekurangan data — hanya diperingatkan. -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { IconArrowLeft, IconLoader2, IconCheck } from '@tabler/icons-svelte';
	import { secureAssetSrc } from '$lib/actions/secureAsset';
	import { getIdToken } from '$lib/services/secureDirectus';
	import { MAX_PHOTOS, MAX_TEXT, currentPeriod, type Checklist, type PhotoCandidate } from '$lib/utils/tutupBulan';

	let projectId = $derived($page.params.project_id as string);

	/** Bulan yang lazim ditutup = bulan lalu (laporan bulan berjalan belum lengkap). */
	function defaultPeriod(): string {
		const d = new Date();
		d.setUTCDate(1);
		d.setUTCMonth(d.getUTCMonth() - 1);
		return d.toISOString().slice(0, 7);
	}
	let period = $state(defaultPeriod());
	let loading = $state(true);
	let busy = $state(false);
	let loadError = $state('');
	let project = $state<any>(null);
	let checklist = $state<Checklist | null>(null);
	let warnings = $state<string[]>([]);
	let schemaReady = $state(true);
	let candidates = $state<PhotoCandidate[]>([]);
	let narasi = $state<any>(null);
	let confirmClose = $state(false);
	let notice = $state<{ ok: boolean; text: string } | null>(null);

	let kendala = $state('');
	let rencana = $state('');
	let catatan = $state('');
	let photoIds = $state<string[]>([]);
	let isClosed = $derived(narasi?.status === 'closed');

	async function api(method: 'GET' | 'POST', qsOrBody: string | object) {
		const token = await getIdToken();
		const res = await fetch(method === 'GET' ? `/api/laporan/tutup-bulan?${qsOrBody}` : '/api/laporan/tutup-bulan', {
			method,
			headers: { Authorization: `Bearer ${token}`, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
			...(method === 'POST' ? { body: JSON.stringify(qsOrBody) } : {})
		});
		const j = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(j?.message || `Gagal (HTTP ${res.status}).`);
		return j;
	}

	async function load() {
		loading = true; loadError = ''; notice = null; confirmClose = false;
		try {
			const r = await api('GET', `projectId=${encodeURIComponent(projectId)}&period=${encodeURIComponent(period)}`);
			project = r.project; checklist = r.checklist; warnings = r.warnings || []; schemaReady = r.schemaReady !== false;
			candidates = r.photoCandidates || []; narasi = r.narasi;
			kendala = narasi?.kendala_utama || ''; rencana = narasi?.rencana_bulan_depan || ''; catatan = narasi?.catatan_manajemen || '';
			photoIds = Array.isArray(narasi?.photo_ids) ? narasi.photo_ids : [];
		} catch (e: any) {
			loadError = e?.message || 'Gagal memuat.';
		} finally {
			loading = false;
		}
	}

	async function submit(action: 'save' | 'close' | 'reopen') {
		busy = true; notice = null;
		try {
			const r = await api('POST', { projectId: Number(projectId), period, action, kendala_utama: kendala, rencana_bulan_depan: rencana, catatan_manajemen: catatan, photo_ids: photoIds });
			narasi = r.narasi; confirmClose = false;
			notice = { ok: true, text: action === 'close' ? '✓ Bulan ditutup. Narasi & foto pilihan Anda dipakai pada Laporan Bulanan Terpadu.' : action === 'reopen' ? '✓ Bulan dibuka kembali (draf).' : '✓ Draf tersimpan.' };
			warnings = (await api('GET', `projectId=${projectId}&period=${period}`).catch(() => ({ warnings }))).warnings || warnings;
		} catch (e: any) {
			notice = { ok: false, text: e?.message || 'Gagal menyimpan.' };
		} finally {
			busy = false;
		}
	}

	// Tombol Tutup Bulan SELALU bisa diklik: bila ada peringatan, tampilkan dulu lalu minta konfirmasi (tidak mengunci tim lapangan).
	function onClose() {
		if (warnings.length && !confirmClose) { confirmClose = true; return; }
		submit('close');
	}
	function togglePhoto(id: string) {
		if (photoIds.includes(id)) photoIds = photoIds.filter((x) => x !== id);
		else if (photoIds.length < MAX_PHOTOS) photoIds = [...photoIds, id];
	}
	const fmt = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });

	onMount(load);
</script>

<div class="max-w-2xl mx-auto px-4 py-4 pb-24">
	<button class="flex items-center gap-1 text-[12px] font-semibold mb-3" style="color: var(--pd)" onclick={() => goto(`/proyek/${projectId}`)}>
		<IconArrowLeft size={16} /> Kembali ke proyek
	</button>
	<h1 class="text-[17px] font-bold" style="color: var(--sys-label)">🗓️ Tutup Bulan{project?.name ? ` — ${project.name}` : ''}</h1>
	<p class="text-[12px] mt-1 mb-3" style="color: var(--sys-label3)">
		Langkah: ① pilih bulan → ② lengkapi laporan harian yang masih kosong → ③ tulis kendala utama &amp; rencana bulan depan → ④ pilih foto terbaik → ⑤ tekan <b>Tutup Bulan</b>. Admin memakai isian ini pada Laporan Bulanan Terpadu.
	</p>

	<label class="block text-[12px] font-semibold mb-1" for="tb-period">① Bulan</label>
	<input id="tb-period" type="month" class="rounded-lg border px-2.5 py-1.5 text-[13px] mb-4" style="border-color: var(--sys-sep)" bind:value={period} onchange={load} max={currentPeriod()} />

	{#if loading}
		<div class="py-10 flex justify-center"><CircularProgressGauge size={56} strokeWidth={5} label="Memuat laporan bulan ini..." /></div>
	{:else if loadError}
		<div class="rounded-xl border p-3 text-[12px]" style="border-color: #FCA5A5; background: #FEF2F2; color: #B91C1C">
			{loadError} <button class="underline font-semibold ml-1" onclick={load}>Coba lagi</button>
		</div>
	{:else}
		{#if !schemaReady}
			<div class="rounded-xl border p-3 text-[12px] mb-3" style="border-color: #FDE68A; background: #FFFBEB; color: #92400E" data-testid="tb-schema-warning">
				Penyimpanan narasi belum aktif (menunggu admin menerapkan skema). Anda tetap bisa melihat checklist; tombol simpan akan memberi pesan bila belum bisa.
			</div>
		{/if}

		{#if isClosed}
			<div class="rounded-xl border p-3 text-[12px] mb-3" style="border-color: #86EFAC; background: #F0FDF4; color: #166534" data-testid="tb-closed">
				<IconCheck size={14} class="inline" /> Bulan ditutup{narasi?.closed_by_name ? ` oleh ${narasi.closed_by_name}` : ''}{narasi?.closed_at ? ` pada ${new Date(narasi.closed_at).toLocaleDateString('id-ID')}` : ''}. Anda masih bisa memperbaiki narasi, atau membuka kembali.
			</div>
		{/if}

		<section class="rounded-xl border p-3 mb-3" style="border-color: var(--sys-sep)" data-testid="tb-checklist">
			<p class="text-[13px] font-bold mb-1">② Kelengkapan laporan harian</p>
			{#if checklist}
				<p class="text-[12px]" style="color: var(--sys-label2)">
					{checklist.hariBerlapor} dari {checklist.hariKalender} hari ada laporan{checklist.kepatuhanPct != null ? ` · kepatuhan ${checklist.kepatuhanPct}%` : ''}{checklist.bulanBerjalan ? ' · bulan masih berjalan' : ''}.
					{#if checklist.laporanDraf}{checklist.laporanDraf} laporan masih draf (tidak dihitung).{/if}
					{#if checklist.laporanDitolak}{checklist.laporanDitolak} laporan ditolak (tidak dihitung).{/if}
				</p>
				{#if checklist.hariKosong.length}
					<p class="text-[11px] mt-2 mb-1 font-semibold" style="color: #B45309">Hari belum ada laporan ({checklist.hariKosong.length}):</p>
					<div class="flex flex-wrap gap-1">{#each checklist.hariKosong as d (d)}<span class="text-[10px] px-1.5 py-0.5 rounded" style="background: #FEF3C7; color: #92400E">{fmt(d)}</span>{/each}</div>
					<p class="text-[11px] mt-1.5" style="color: var(--sys-label3)">Hari tanpa kegiatan (libur) tidak perlu laporan — Anda tetap bisa menutup bulan.</p>
				{:else}
					<p class="text-[12px] mt-1" style="color: #166534">✓ Semua hari target sudah ada laporan.</p>
				{/if}
			{/if}
		</section>

		<section class="rounded-xl border p-3 mb-3" style="border-color: var(--sys-sep)">
			<p class="text-[13px] font-bold mb-2">③ Narasi bulan ini</p>
			<label class="block text-[12px] font-semibold" for="tb-kendala">Kendala utama</label>
			<textarea id="tb-kendala" rows="3" maxlength={MAX_TEXT} bind:value={kendala} class="w-full rounded-lg border text-[12px] p-2.5 mb-2" style="border-color: var(--sys-sep)" placeholder="Apa hambatan terbesar bulan ini? (cuaca, material, akses area, dll.)"></textarea>
			<label class="block text-[12px] font-semibold" for="tb-rencana">Rencana bulan depan</label>
			<textarea id="tb-rencana" rows="3" maxlength={MAX_TEXT} bind:value={rencana} class="w-full rounded-lg border text-[12px] p-2.5 mb-2" style="border-color: var(--sys-sep)" placeholder="Pekerjaan utama & target bulan depan"></textarea>
			<label class="block text-[12px] font-semibold" for="tb-catatan">Catatan khusus untuk manajemen <span class="font-normal" style="color: var(--sys-label3)">(internal — tidak dicetak untuk klien)</span></label>
			<textarea id="tb-catatan" rows="2" maxlength={MAX_TEXT} bind:value={catatan} class="w-full rounded-lg border text-[12px] p-2.5" style="border-color: var(--sys-sep)" placeholder="Hal yang perlu diketahui manajemen (mis. potensi VO, kebutuhan dukungan)"></textarea>
		</section>

		<section class="rounded-xl border p-3 mb-3" style="border-color: var(--sys-sep)" data-testid="tb-photos">
			<p class="text-[13px] font-bold">④ Foto terbaik ({photoIds.length}/{MAX_PHOTOS})</p>
			<p class="text-[11px] mb-2" style="color: var(--sys-label3)">Ketuk foto untuk memilih/membatalkan. Tanpa pilihan, sistem memilih otomatis merata sepanjang bulan.</p>
			{#if candidates.length}
				<div class="grid grid-cols-4 gap-1.5 max-h-60 overflow-y-auto">
					{#each candidates as c (c.id)}
						<button type="button" onclick={() => togglePhoto(c.id)} aria-pressed={photoIds.includes(c.id)} title={`${c.label} · ${c.date}`}
							class="relative aspect-square overflow-hidden rounded border-2 {photoIds.includes(c.id) ? 'border-blue-600' : 'border-transparent opacity-60'}">
							<img use:secureAssetSrc={`/assets/${c.id}?width=160`} alt={c.label} class="w-full h-full object-cover" loading="lazy" />
							{#if photoIds.includes(c.id)}<span class="absolute top-0 right-0 bg-blue-600 text-white text-[9px] px-1">{photoIds.indexOf(c.id) + 1}</span>{/if}
						</button>
					{/each}
				</div>
			{:else}<p class="text-[12px]" style="color: var(--sys-label3)">Tidak ada foto pada laporan bulan ini.</p>{/if}
		</section>

		{#if notice}<p class="text-[12px] mb-2" style="color: {notice.ok ? '#166534' : '#B91C1C'}" data-testid="tb-notice">{notice.text}</p>{/if}

		{#if confirmClose && warnings.length}
			<div class="rounded-xl border p-3 mb-2 text-[12px]" style="border-color: #FDE68A; background: #FFFBEB; color: #92400E" data-testid="tb-confirm">
				<p class="font-semibold mb-1">Masih ada yang belum lengkap:</p>
				<ul class="list-disc pl-4">{#each warnings as w (w)}<li>{w}</li>{/each}</ul>
				<p class="mt-1">Tetap tutup bulan? Admin akan melihat catatan ini pada audit cetak.</p>
			</div>
		{/if}

		<div class="flex gap-2">
			<button class="flex-1 h-10 rounded-lg border text-[13px] font-semibold disabled:opacity-50" style="border-color: var(--sys-sep)" disabled={busy} onclick={() => submit('save')}>Simpan Draf</button>
			{#if isClosed}
				<button class="flex-1 h-10 rounded-lg border text-[13px] font-semibold disabled:opacity-50" style="border-color: #DC2626; color: #DC2626" disabled={busy} onclick={() => submit('reopen')}>Buka Kembali</button>
			{:else}
				<button class="flex-1 h-10 rounded-lg text-[13px] font-bold text-white disabled:opacity-50 flex items-center justify-center gap-1" style="background: var(--pd, #16A34A)" disabled={busy} onclick={onClose} data-testid="tb-close">
					{#if busy}<IconLoader2 size={16} class="animate-spin" />{/if}{confirmClose ? 'Ya, Tetap Tutup Bulan' : 'Tutup Bulan'}
				</button>
			{/if}
		</div>
	{/if}
</div>
