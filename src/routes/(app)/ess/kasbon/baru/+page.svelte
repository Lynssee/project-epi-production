<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { ajukanKasbon, getKasbonStatus } from '$lib/services/ess/kasbon';
	import { IconArrowLeft, IconLoader2, IconCircleCheck } from '@tabler/icons-svelte';
	import { SectionGuide, FieldHint, HelpIcon } from '$lib/components/hints';
	// Impor modul hint langsung (bukan barrel) — lihat catatan bundling di getHint.ts.
	import { essHints } from '$lib/data/hints/ess';
	import { getHint } from '$lib/data/hints/getHint';

	/** Pintasan pembaca hint modul ESS; memperingatkan kunci salah-ketik saat DEV. */
	const h = (key: string) => getHint(essHints, key, 'ess');

	let loading = $state(true);
	let plafon = $state(0);
	let tenorMaxBulan = $state(3);
	let bisaAjukanBaru = $state(true);

	let nominal = $state<number | null>(null);
	let tenor = $state(3);
	let keterangan = $state('');

	let submitting = $state(false);
	let errorMsg = $state('');
	let success = $state(false);

	onMount(async () => {
		try {
			const status = await getKasbonStatus();
			plafon = status.plafon;
			tenorMaxBulan = status.tenorMaxBulan;
			bisaAjukanBaru = status.bisaAjukanBaru;
			tenor = Math.min(tenor, tenorMaxBulan);
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat data kasbon.';
		} finally {
			loading = false;
		}
	});

	function formatRupiah(n: number) {
		return 'Rp ' + Math.round(n || 0).toLocaleString('id-ID');
	}

	let cicilanEstimasi = $derived(nominal && tenor ? Math.round(nominal / tenor) : 0);
	// H-07 fix: plafon<=0 berarti kasbon TIDAK diizinkan, bukan tanpa batas — jangan lolos.
	let canSubmit = $derived(
		bisaAjukanBaru && !!nominal && nominal > 0 && plafon > 0 && nominal <= plafon && tenor > 0 && tenor <= tenorMaxBulan && !!keterangan.trim() && !submitting
	);

	async function handleSubmit() {
		if (!canSubmit || !nominal) return;
		submitting = true;
		errorMsg = '';
		try {
			await ajukanKasbon({ nominal, tenor, keterangan: keterangan.trim() });
			success = true;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal mengajukan kasbon.';
		} finally {
			submitting = false;
		}
	}
</script>

<div class="w-full p-4 pb-24">
	<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto('/ess/kasbon')}>
		<IconArrowLeft size={15} /> Kembali
	</button>

	{#if loading}
		<CircularProgressGauge size={54} strokeWidth={4} label="Memuat data kasbon..." />
	{:else if success}
		<div class="text-center py-16">
			<IconCircleCheck size={40} style="color: #16A34A; margin: 0 auto" />
			<p class="text-[14px] font-semibold mt-3" style="color: var(--sys-label)">Pengajuan kasbon terkirim</p>
			<p class="text-[12px] mt-1" style="color: var(--sys-label3)">Menunggu persetujuan atasan → HRD → Finance.</p>
			<button class="mt-5 px-4 py-2 rounded-lg text-[12px] font-semibold text-white" style="background: var(--p, var(--g))" onclick={() => goto('/ess/kasbon')}>
				Kembali ke Riwayat Kasbon
			</button>
		</div>
	{:else if !bisaAjukanBaru}
		<div class="glass-panel rounded-2xl p-8 text-center max-w-md mx-auto mt-10">
			<h3 class="text-base font-bold mb-2" style="color: var(--sys-label)">Belum Bisa Mengajukan Kasbon Baru</h3>
			<p class="text-[12px]" style="color: var(--sys-label3)">Anda masih memiliki kasbon yang belum lunas. Lunasi dulu sebelum mengajukan kasbon baru.</p>
		</div>
	{:else}
		<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">Ajukan Kasbon</h1>
		<p class="text-[11px] mb-4" style="color: var(--sys-label3)">Plafon maks {formatRupiah(plafon)} · tenor maks {tenorMaxBulan} bulan</p>

		<SectionGuide
			id="ess.kasbon.page"
			title={h('kasbon.page').sectionGuide?.title}
			steps={h('kasbon.page').sectionGuide?.steps ?? []}
		/>

		<div class="flex flex-col gap-4">
			<div>
				<label class="text-[12px] font-semibold block mb-1.5" style="color: var(--sys-label)" for="nominal">Nominal (Rp)</label>
				<input
					id="nominal"
					type="number"
					class="w-full rounded-lg border text-[13px] p-3"
					style="border-color: var(--sys-sep)"
					placeholder="0"
					bind:value={nominal}
				/>
				{#if nominal && plafon > 0 && nominal > plafon}
					<p class="text-[11px] mt-1" style="color: #DC2626">Melebihi plafon {formatRupiah(plafon)}.</p>
				{:else}
					<FieldHint
						text={h('kasbon.form.nominal').fieldHint}
						type={h('kasbon.form.nominal').type}
					/>
				{/if}
			</div>

			<div>
				<label class="text-[12px] font-semibold mb-1.5 inline-flex items-center gap-1.5" style="color: var(--sys-label)" for="tenor">
					Tenor (bulan)<HelpIcon text={h('kasbon.form.tenor').helpIcon} position="bottom" />
				</label>
				<input
					id="tenor"
					type="number"
					min="1"
					max={tenorMaxBulan}
					class="w-full rounded-lg border text-[13px] p-3"
					style="border-color: var(--sys-sep)"
					bind:value={tenor}
				/>
				<FieldHint text={h('kasbon.form.tenor').fieldHint} />
			</div>

			<div class="rounded-lg px-4 py-2.5 text-[12px] flex justify-between items-center font-semibold" style="background: var(--sys-fill); color: var(--sys-label)">
				<span>Estimasi Cicilan/Bulan:</span>
				<span class="text-[14px]" style="color: var(--p, var(--g))">{formatRupiah(cicilanEstimasi)}</span>
			</div>

			<div>
				<label class="text-[12px] font-semibold block mb-1.5" style="color: var(--sys-label)" for="keterangan">Alasan *</label>
				<textarea
					id="keterangan"
					class="w-full rounded-lg border text-[13px] p-3"
					style="border-color: var(--sys-sep)"
					rows="3"
					placeholder="Sebutkan alasan pengajuan kasbon"
					bind:value={keterangan}
				></textarea>
				<FieldHint
					text={h('kasbon.form.keterangan').fieldHint}
					type={h('kasbon.form.keterangan').type}
				/>
			</div>

			{#if errorMsg}
				<p class="text-[12px]" style="color: #DC2626">{errorMsg}</p>
			{/if}

			<button
				class="w-full h-12 rounded-xl text-[14px] font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40"
				style="background: var(--p, var(--g))"
				disabled={!canSubmit}
				onclick={handleSubmit}
			>
				{#if submitting}<IconLoader2 size={16} class="animate-spin" />{/if}
				Kirim Pengajuan
			</button>
		</div>
	{/if}
</div>
