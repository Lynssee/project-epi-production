<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { submitShiftHandover, searchKaryawan } from '$lib/services/security';
	import { IconArrowLeft, IconLoader2 } from '@tabler/icons-svelte';
	import { fetchRekonsiliasiKunci, type RekonsiliasiKunci, type SlotKunci } from '$lib/services/kunci';

	// Rekonsiliasi kotak kunci (G_SEC8): ditampilkan sebelum serah-terima; gagal memuat tidak memblokir form.
	let rekon = $state<RekonsiliasiKunci | null>(null);
	// Checklist per slot: id kunci berstatus `tersedia` yang dicentang satpam "ada di slotnya".
	let dicekIds = $state<number[]>([]);
	const slotTersedia = $derived((rekon?.slots || []).filter((k) => k.status === 'tersedia'));
	const grupKotak = $derived.by(() => {
		const m = new Map<string, SlotKunci[]>();
		for (const k of rekon?.slots || []) {
			const nama = (k.lokasi_kotak || '').trim() || 'Kotak belum ditentukan';
			if (!m.has(nama)) m.set(nama, []);
			m.get(nama)!.push(k);
		}
		return [...m.entries()].map(([nama, items]) => ({ nama, items }));
	});
	function toggleDicek(id: number) {
		dicekIds = dicekIds.includes(id) ? dicekIds.filter((x) => x !== id) : [...dicekIds, id];
	}
	function centangSemua() {
		dicekIds = slotTersedia.map((k) => k.id);
	}
	onMount(async () => {
		try {
			rekon = await fetchRekonsiliasiKunci();
		} catch (err) {
			console.warn('[serah-terima] rekonsiliasi kunci tidak dapat dimuat:', err);
		}
	});

	let saving = $state(false);
	let errorMsg = $state('');
	let successMsg = $state('');

	let form = $state({
		shift: 'pagi' as 'pagi' | 'siang' | 'malam',
		tanggal: new Date().toISOString().split('T')[0],
		catatan: ''
	});

	let masukQuery = $state('');
	let masukResults = $state<any[]>([]);
	let selectedMasuk = $state<{ id: number; label: string } | null>(null);

	let searchTimer: ReturnType<typeof setTimeout>;
	function onMasukQueryInput() {
		selectedMasuk = null;
		clearTimeout(searchTimer);
		searchTimer = setTimeout(async () => {
			if (!masukQuery.trim()) { masukResults = []; return; }
			const results = await searchKaryawan(masukQuery);
			masukResults = results.map((r) => ({ id: r.id, label: r.nama_karyawan }));
		}, 300);
	}

	function pickMasuk(p: { id: number; label: string }) {
		selectedMasuk = p;
		masukQuery = p.label;
		masukResults = [];
	}

	// G_SEC7 (mode soft): alasan tetap menyerahkan walau belum lengkap, diminta setelah server menjawab 422.
	let gateSec7Reason = '';
	// G_SEC8 (mode soft): alasan tetap menyerahkan walau ada kunci belum kembali. Server hanya memakai
	// alasan yang relevan dengan gate yang menolak, jadi alasan yang sama dikirim untuk keduanya.
	let gateSec8Reason = '';

	async function submitForm() {
		errorMsg = ''; successMsg = '';
		const karyawanId = $authStore.karyawanId;
		if (!karyawanId) { errorMsg = 'Profil karyawan tidak ditemukan di sesi login.'; return; }
		if (!selectedMasuk) { errorMsg = 'Pilih satpam yang masuk-shift dari hasil pencarian.'; return; }

		saving = true;
		try {
			await submitShiftHandover({
				shift: form.shift,
				tanggal: form.tanggal,
				catatan: form.catatan,
				satpam_masuk_id: selectedMasuk.id,
				gate_sec7_reason: gateSec7Reason.trim() || undefined,
				gate_sec8_reason: gateSec8Reason.trim() || undefined,
				// Hanya dikirim bila kotak kunci terdaftar; klien tanpa data kunci tidak dikenai aturan cek fisik.
				kunci_dicek_ids: rekon && rekon.total > 0 ? dicekIds : undefined
			});
			successMsg = 'Serah-terima shift tercatat. Menunggu konfirmasi satpam masuk-shift.';
			form.catatan = '';
			selectedMasuk = null;
			masukQuery = '';
			gateSec7Reason = '';
			gateSec8Reason = '';
			dicekIds = [];
			try {
				rekon = await fetchRekonsiliasiKunci();
			} catch {
				/* panel rekonsiliasi hanya informasi */
			}
		} catch (err) {
			if (err instanceof Error && (err as any).isGateSec7) {
				// Pesan G_SEC8 menyebut "kunci" dan meminta minimal 20 karakter; G_SEC7 cukup 5.
				const kunci = /kunci/i.test(err.message);
				const minLen = kunci ? 20 : 5;
				const alasan = window.prompt(`${err.message}\n\nAlasan tetap menyerahkan (min. ${minLen} karakter):`, '');
				if (alasan && alasan.trim().length >= minLen) {
					gateSec7Reason = alasan.trim();
					if (kunci) gateSec8Reason = alasan.trim();
					saving = false;
					await submitForm();
					return;
				}
				errorMsg = err.message;
			} else {
				errorMsg = err instanceof Error ? err.message : 'Gagal menyimpan serah-terima.';
			}
		}
		saving = false;
	}
</script>

<div class="scroll-body">
	<div class="w-full p-4 pb-24">
		<div class="flex items-center gap-2 mb-4">
			<button class="w-8 h-8 rounded-lg flex items-center justify-center" style="background: var(--sys-fill)" onclick={() => goto('/satpam')}>
				<IconArrowLeft size={16} />
			</button>
			<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">Serah-Terima Shift</h1>
		</div>

		{#if errorMsg}<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--rel); color: var(--red)">{errorMsg}</div>{/if}
		{#if successMsg}<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--gg); color: var(--ggd)">{successMsg}</div>{/if}

		{#if rekon && rekon.total > 0}
			<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: {rekon.cocok ? 'var(--gg)' : '#FEF3C7'}; color: {rekon.cocok ? 'var(--ggd)' : '#92400E'}">
				<p class="font-semibold">
					{rekon.cocok ? `Semua kunci operasional ada di slotnya (${rekon.di_slot}/${rekon.total} cocok)` : `${rekon.belum_kembali.length} kunci belum kembali ke slot`}
				</p>
				{#if !rekon.cocok}
					<ul class="mt-1 list-disc pl-4">
						{#each rekon.belum_kembali as k}<li>{k.kode} {k.nama} — dibawa {k.pemegang_nama ?? '-'}</li>{/each}
					</ul>
					<p class="mt-1">Terima kembali di menu <a class="underline font-semibold" href="/satpam/kunci">Kotak Kunci</a>, atau beri izin bawa pulang. Bila tetap diserahkan, alasan akan diminta.</p>
				{/if}
				{#if rekon.izin_bawa_pulang.length > 0}
					<p class="mt-1">Izin bawa pulang: {rekon.izin_bawa_pulang.map((k) => `${k.kode} (${k.pemegang_nama ?? '-'})`).join(', ')}</p>
				{/if}
			</div>

			<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
				<div class="flex items-center justify-between mb-1">
					<p class="font-semibold">Checklist kotak kunci ({dicekIds.length}/{slotTersedia.length} dicek)</p>
					<button class="px-2 py-1 rounded-lg text-[11px] font-semibold" style="background: var(--g); color: white" onclick={centangSemua}>Centang semua</button>
				</div>
				<p class="mb-2" style="color: var(--sys-label3)">Lihat kotak kunci secara fisik, lalu centang kunci yang benar-benar tergantung di slotnya. Kunci yang sedang dipinjam tidak perlu dicentang.</p>
				{#each grupKotak as g (g.nama)}
					<p class="font-semibold mt-2">{g.nama}</p>
					{#each g.items as k (k.id)}
						{#if k.status === 'tersedia'}
							<label class="flex items-center gap-2 py-1">
								<input type="checkbox" checked={dicekIds.includes(k.id)} onchange={() => toggleDicek(k.id)} />
								<span class="font-medium">{k.nomor_hook || '—'}</span> {k.kode} {k.nama}{k.is_restricted ? ' 🔒' : ''}
							</label>
						{:else}
							<p class="py-1 pl-6" style="color: var(--sys-label3)">{k.nomor_hook || '—'} {k.kode} {k.nama} — {k.status === 'dipinjam' ? 'dibawa' : 'izin bawa pulang:'} {k.pemegang_nama ?? '-'}</p>
						{/if}
					{/each}
				{/each}
			</div>
		{/if}

		<input class="w-full rounded-lg px-3 py-2 text-[13px] mb-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" type="date" bind:value={form.tanggal} />
		<select class="w-full rounded-lg px-3 py-2 text-[13px] mb-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" bind:value={form.shift}>
			<option value="pagi">Pagi</option>
			<option value="siang">Siang</option>
			<option value="malam">Malam</option>
		</select>

		<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label)">Satpam Masuk-Shift (penerima)</label>
		<input class="w-full rounded-lg px-3 py-2 text-[13px] mb-1" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" placeholder="Cari nama…" bind:value={masukQuery} oninput={onMasukQueryInput} />
		{#if masukResults.length > 0}
			<div class="rounded-lg mb-2 overflow-hidden" style="border: 1px solid var(--sys-sep)">
				{#each masukResults as r}
					<button class="w-full text-left px-3 py-2 text-[12px]" style="background: white" onclick={() => pickMasuk(r)}>{r.label}</button>
				{/each}
			</div>
		{/if}

		<textarea rows="4" class="w-full rounded-lg px-3 py-2 text-[13px] mb-3" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" placeholder="Catatan: kondisi, barang belum kembali, tamu masih di dalam, dsb" bind:value={form.catatan}></textarea>
		<p class="text-[11px] mb-3 -mt-2" style="color: var(--sys-label-secondary, #666)">Tulis kondisi pos, barang yang belum kembali, dan tamu yang masih di dalam. Catatan terlalu singkat atau belum ada ronda tercatat akan meminta alasan sebelum serah-terima dikirim.</p>

		<button class="w-full rounded-lg py-2.5 text-[13px] font-semibold text-white disabled:opacity-50" style="background: var(--g)" disabled={saving} onclick={submitForm}>
			{#if saving}<IconLoader2 size={16} class="animate-spin inline mr-1" />{/if}
			{saving ? 'Menyimpan…' : 'Serah-Terima'}
		</button>
	</div>
</div>
