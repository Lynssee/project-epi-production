<!-- src/lib/components/manpower/ManpowerK3Chip.svelte
     Badge status tes K3 dasar + tombol "Kirim Tes K3" untuk CALON manpower (Integrasi Quiz ↔ Rekrutmen, Fase 5).
     Pekerja mengerjakan tes dari HP lewat tautan WhatsApp, tanpa login; hasil dinilai otomatis di server admin dan menjadi syarat
     verifikasi HRD (gate G_MP_K3_TES). Komponen "bodoh": status diberikan induk (1 permintaan untuk seluruh daftar), bukan per kartu. -->
<script lang="ts">
	import { kirimTesK3, type K3Status } from '$lib/services/manpowerK3';

	let {
		manpowerId,
		nama = '',
		noHp = null,
		status = undefined,
		kuisJudul = null,
		onChanged = undefined
	}: {
		manpowerId: number;
		nama?: string | null;
		noHp?: number | string | null;
		status?: K3Status;
		kuisJudul?: string | null;
		onChanged?: () => void;
	} = $props();

	const toast = {
		success: (m: string) => (window as any).__showToast?.(m, 'success'),
		error: (m: string) => (window as any).__showToast?.(m, 'error')
	};

	const LABEL: Record<string, { l: string; c: string }> = {
		lulus: { l: 'K3 lulus', c: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
		belum_lulus: { l: 'K3 belum lulus', c: 'bg-rose-500/15 text-rose-700 dark:text-rose-300' },
		berjalan: { l: 'K3 menunggu dikerjakan', c: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' },
		kedaluwarsa: { l: 'K3 tautan kedaluwarsa', c: 'bg-gray-500/15 text-gray-600 dark:text-gray-300' },
		belum_dikirim: { l: 'K3 belum dikirim', c: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' }
	};

	let busy = $state(false);
	let tautan = $state<string | null>(null);
	let st = $derived(status?.status ?? 'belum_dikirim');
	let adaHp = $derived(String(noHp ?? '').replace(/\D/g, '').length >= 8);

	async function kirim(e: Event, lewatWa: boolean) {
		e.stopPropagation(); // kartu induk adalah tombol accordion
		if (busy) return;
		busy = true;
		const r = await kirimTesK3(manpowerId, lewatWa);
		busy = false;
		if (!r.ok) return toast.error(r.message);
		tautan = r.url;
		if (lewatWa && r.waTerkirim) toast.success(`Tautan tes K3 terkirim via WhatsApp ke ${nama || 'pekerja'}.`);
		else {
			try { await navigator.clipboard.writeText(r.url); } catch { /* izin clipboard ditolak → tautan tetap tampil untuk disalin manual */ }
			toast.success(lewatWa ? `WhatsApp tidak terkirim (${r.waAlasan || 'alasan tidak diketahui'}). Tautan disalin — kirim manual.` : 'Tautan tes K3 disalin. Kirimkan ke pekerja.');
		}
		onChanged?.();
	}
</script>

<div class="space-y-1.5" role="presentation" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
	<div class="flex items-center gap-1.5 flex-wrap">
		<span
			class="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold {LABEL[st]?.c}"
			title={kuisJudul ? `${kuisJudul}${status?.skor != null ? ` — skor ${status.skor}${status.ambang != null ? ` (minimal ${status.ambang})` : ''}` : ''}` : 'Tes K3 dasar'}
		>
			{LABEL[st]?.l ?? st}{status?.skor != null ? ` · ${status.skor}` : ''}
		</span>
		{#if st !== 'lulus'}
			<button
				type="button"
				disabled={busy}
				onclick={(e) => kirim(e, adaHp)}
				class="px-2 py-1 rounded-md border border-teal-500/50 text-[10px] font-semibold text-teal-700 dark:text-teal-300 disabled:opacity-50"
				title={adaHp ? 'Kirim tautan tes K3 ke WhatsApp pekerja (nomor HP terdaftar). Pekerja mengerjakan dari HP tanpa login.' : 'Nomor HP kosong — tautan disalin untuk dibagikan manual.'}
			>
				{busy ? '…' : adaHp ? '📲 Kirim Tes K3' : '🔗 Salin Tautan K3'}
			</button>
			{#if adaHp}
				<button type="button" disabled={busy} onclick={(e) => kirim(e, false)} class="px-1.5 py-1 text-[10px] text-gray-500 underline disabled:opacity-50" title="Hanya salin tautan tanpa kirim WhatsApp">salin tautan</button>
			{/if}
		{/if}
	</div>
	{#if tautan}
		<input readonly value={tautan} onfocus={(e) => e.currentTarget.select()} class="w-full rounded-md border border-gray-300 dark:border-slate-600 bg-transparent px-2 py-1 text-[10px]" aria-label="Tautan tes K3" />
	{/if}
</div>
