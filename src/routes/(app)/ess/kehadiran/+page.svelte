<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import { getRiwayatAbsensi, type AbsensiHarianRecord } from '$lib/services/ess/attendance';
	import { IconLoader2, IconAlertTriangle, IconFileExport } from '@tabler/icons-svelte';
	import EssExportSheet from '$lib/components/ess/EssExportSheet.svelte';

	let loading = $state(true);
	let errorMsg = $state('');
	let rows = $state<AbsensiHarianRecord[]>([]);
	let periode = $state<{ dari: string; sampai: string }>({ dari: '', sampai: '' });
	let dari = $state('');
	let sampai = $state('');
	let sheetOpen = $state(false);

	function ymd(d: Date) {
		const p = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
	}

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			const res = await getRiwayatAbsensi({ dari: dari || undefined, sampai: sampai || undefined });
			rows = res.rows;
			periode = res.periode;
			dari = res.periode.dari;
			sampai = res.periode.sampai;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat riwayat kehadiran.';
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		const back = new Date();
		back.setDate(back.getDate() - 30);
		dari = ymd(back);
		sampai = ymd(new Date());
		load();
	});

	function validLabel(jam: string | null, valid: boolean | null) {
		if (!jam || jam === '-') return '-';
		return valid === false ? 'Luar radius' : 'Valid';
	}

	function fmtDate(s: string) {
		if (!s) return '-';
		const parts = s.split('-');
		if (parts.length !== 3) return s;
		const m = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
		return `${parseInt(parts[2])} ${m[parseInt(parts[1]) - 1] || parts[1]} ${parts[0]}`;
	}

	const exportColumns = [
		{ key: 'tanggal', label: 'Tanggal' },
		{ key: 'status', label: 'Status' },
		{ key: 'jam_masuk', label: 'Jam Masuk' },
		{ key: 'valid_masuk', label: 'Valid Masuk' },
		{ key: 'jam_pulang', label: 'Jam Pulang' },
		{ key: 'valid_pulang', label: 'Valid Pulang' },
		{ key: 'lokasi', label: 'Lokasi' },
		{ key: 'keterangan', label: 'Keterangan' }
	];
	const exportRows = $derived(
		rows.map((r) => ({
			tanggal: fmtDate(r.tanggal),
			status: r.status ?? '-',
			jam_masuk: r.jam_masuk || '-',
			valid_masuk: validLabel(r.jam_masuk, r.masuk_valid),
			jam_pulang: r.jam_keluar || '-',
			valid_pulang: validLabel(r.jam_keluar, r.pulang_valid),
			lokasi: r.lokasi || '-',
			keterangan: r.keterangan || '-'
		}))
	);
</script>

<div class="w-full p-4 md:p-6 pb-24">
	<div class="mb-6 flex items-start justify-between gap-3">
		<div>
			<h1 class="text-2xl md:text-3xl font-extrabold tracking-tight gradient-text">Riwayat Kehadiran</h1>
			<p class="text-sm md:text-base mt-1 font-medium" style="color: var(--sys-label3)">
				Absensi harian Anda — pilih rentang lalu ekspor
			</p>
		</div>
		<button
			class="w-11 h-11 shrink-0 rounded-full flex items-center justify-center border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70 text-slate-500 disabled:opacity-40 hover:scale-105 transition-transform"
			onclick={() => (sheetOpen = true)}
			disabled={rows.length === 0}
			aria-label="Ekspor riwayat kehadiran"
			title="Ekspor riwayat kehadiran (PDF / CSV)"
		>
			<IconFileExport size={20} />
		</button>
	</div>

	<div class="glass-panel rounded-2xl p-4 mb-5 flex flex-wrap items-end gap-3">
		<label class="flex flex-col gap-1 text-xs font-semibold" style="color: var(--sys-label3)">
			Dari
			<input type="date" bind:value={dari} max={sampai} class="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
		</label>
		<label class="flex flex-col gap-1 text-xs font-semibold" style="color: var(--sys-label3)">
			Sampai
			<input type="date" bind:value={sampai} min={dari} class="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
		</label>
		<button
			class="rounded-xl px-4 py-2 text-sm font-bold text-white gradient-bg disabled:opacity-50"
			onclick={load}
			disabled={loading || !dari || !sampai || dari > sampai}
		>
			{loading ? 'Memuat…' : 'Terapkan'}
		</button>
	</div>

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-20">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat riwayat kehadiran..." />
		</div>
	{:else if errorMsg}
		<div class="glass-panel rounded-2xl p-8 text-center max-w-md mx-auto mt-10">
			<div class="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
				<IconAlertTriangle size={32} style="color: #DC2626" />
			</div>
			<h3 class="text-lg font-bold text-red-600 mb-2">Terjadi Kesalahan</h3>
			<p class="text-sm text-red-500 mb-6">{errorMsg}</p>
			<button class="px-6 py-2.5 rounded-xl text-sm font-bold text-white gradient-bg" onclick={load}>Coba Lagi</button>
		</div>
	{:else if rows.length === 0}
		<div class="glass-panel rounded-2xl p-10 text-center">
			<p class="text-sm font-medium" style="color: var(--sys-label3)">
				Tidak ada catatan kehadiran pada {fmtDate(periode.dari)} – {fmtDate(periode.sampai)}.
			</p>
		</div>
	{:else}
		<div class="glass-panel rounded-2xl overflow-x-auto">
			<table class="w-full text-xs md:text-sm">
				<thead>
					<tr class="text-left" style="color: var(--sys-label3)">
						<th class="px-3 py-2.5 font-bold">Tanggal</th>
						<th class="px-3 py-2.5 font-bold">Status</th>
						<th class="px-3 py-2.5 font-bold">Masuk</th>
						<th class="px-3 py-2.5 font-bold">Pulang</th>
						<th class="px-3 py-2.5 font-bold">Lokasi</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as r (r.id)}
						<tr class="border-t border-white/10">
							<td class="px-3 py-2.5 font-semibold" style="color: var(--sys-label)">{fmtDate(r.tanggal)}</td>
							<td class="px-3 py-2.5" style="color: var(--sys-label3)">{r.status || '-'}</td>
							<td class="px-3 py-2.5" style="color: var(--sys-label3)">
								{r.jam_masuk || '--:--'}
								{#if r.jam_masuk && r.masuk_valid === false}
									<span class="ml-1 text-[10px] font-bold text-amber-600">luar radius</span>
								{/if}
							</td>
							<td class="px-3 py-2.5" style="color: var(--sys-label3)">
								{r.jam_keluar || '--:--'}
								{#if r.jam_keluar && r.pulang_valid === false}
									<span class="ml-1 text-[10px] font-bold text-amber-600">luar radius</span>
								{/if}
							</td>
							<td class="px-3 py-2.5" style="color: var(--sys-label4)">{r.lokasi || '-'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<EssExportSheet
	open={sheetOpen}
	onClose={() => (sheetOpen = false)}
	judul="Riwayat Kehadiran Saya"
	filename={`kehadiran-saya-${periode.dari}_sd_${periode.sampai}`}
	subjudul={`Periode ${fmtDate(periode.dari)} – ${fmtDate(periode.sampai)}`}
	columns={exportColumns}
	rows={exportRows}
/>
