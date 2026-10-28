<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// Real Profit R1 — "Log Sewa Keluar": alat milik kita yang DISEWAKAN ke customer di proyek Anda. Catat timesheet harian (jam,
	// hour meter, lembur) dan BBM yang ditanggung Eltama. BBM ini otomatis masuk HPP rental di dashboard admin. Berbeda dari
	// "Alat Sewa di Site Saya" (alat yang kita SEWA dari vendor). Kontrak sewa dibuat admin di /sales/rental.
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { IconArrowLeft, IconLoader2, IconTruckDelivery, IconGauge, IconCheck } from '@tabler/icons-svelte';
	import { FieldHint } from '$lib/components/hints';
	import { authStore } from '$lib/stores/auth';
	import { fetchKontrakSewaKeluarSaya, simpanTimesheetLapangan, type KontrakSewaKeluarRow } from '$lib/services/sewaKeluarLapanganApi';
	import { parseNum, validateTimesheet } from '$lib/utils/sewaKeluarUtils';

	let loading = $state(true);
	let loadError = $state('');
	let rows = $state<KontrakSewaKeluarRow[]>([]);
	let pencatat = $state('');

	const hariIni = () => new Date().toISOString().slice(0, 10);

	// Form per kontrak yang sedang dibuka (satu form aktif sekaligus — layar kecil).
	let openId = $state<string | null>(null);
	let form = $state({ tanggal: hariIni(), jam_mulai: '', jam_selesai: '', hm: '', lembur: '', bbm_liter: '', bbm_rp: '', catatan: '' });
	let errors = $state<string[]>([]);
	let saving = $state(false);
	let sukses = $state('');

	async function load() {
		loading = true;
		loadError = '';
		try {
			rows = await fetchKontrakSewaKeluarSaya();
		} catch (e: any) {
			console.error('Gagal memuat kontrak sewa keluar:', e);
			loadError = 'Gagal memuat kontrak sewa. Coba lagi sebentar.';
			rows = [];
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		const unsub = authStore.subscribe(async (s) => {
			if (!s.checked || !s.user?.email) return;
			pencatat = s.user.displayName || s.user.email;
			await load();
		});
		return unsub;
	});

	function buka(id: string) {
		openId = id;
		errors = [];
		sukses = '';
		form = { tanggal: hariIni(), jam_mulai: '', jam_selesai: '', hm: '', lembur: '', bbm_liter: '', bbm_rp: '', catatan: '' };
	}

	async function simpan(row: KontrakSewaKeluarRow) {
		const input = {
			tanggal: form.tanggal,
			jam_mulai: form.jam_mulai || undefined,
			jam_selesai: form.jam_selesai || undefined,
			hour_meter_reading: parseNum(form.hm),
			overtime_hours: parseNum(form.lembur),
			bbm_liter: parseNum(form.bbm_liter),
			bbm_rp: parseNum(form.bbm_rp),
			catatan: form.catatan
		};
		errors = validateTimesheet(input, { lastHourMeter: row.last_hour_meter, hariIni: hariIni() });
		if (errors.length) return;
		saving = true;
		try {
			await simpanTimesheetLapangan(row.contract_id, input, pencatat);
			sukses = `Timesheet ${input.tanggal} tersimpan (draft — menunggu konfirmasi admin).`;
			openId = null;
			await load();
		} catch (e: any) {
			console.error('Gagal menyimpan timesheet:', e);
			errors = ['Gagal menyimpan timesheet. Periksa koneksi lalu coba lagi.'];
		} finally {
			saving = false;
		}
	}

	const fmtTgl = (t: string | null) => (t ? new Date(t).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
	const warnaPaket: Record<string, string> = { aman: '#16a34a', mendekati: '#ea580c', habis: '#dc2626' };
</script>

<svelte:head>
	<title>Log Sewa Keluar</title>
</svelte:head>

<div class="flex-1 flex flex-col h-full">
	<div class="px-4 py-3 border-b flex items-center justify-between" style="border-color: var(--sys-sep)">
		<button type="button" class="flex items-center gap-1 text-sm text-gray-500" onclick={() => goto('/sewa-alat')}>
			<IconArrowLeft size={16} /> Kembali
		</button>
	</div>

	<div class="scroll-body px-4 py-4 max-w-2xl mx-auto w-full space-y-3">
		<div>
			<p class="text-base font-bold" style="color: var(--sys-label)">🚚 Log Sewa Keluar</p>
			<p class="text-xs mt-0.5" style="color: var(--sys-label3)">
				Alat milik Eltama yang DISEWAKAN ke customer di proyek Anda. Catat jam kerja, hour meter, dan BBM yang ditanggung Eltama.
				BBM yang Anda catat otomatis dihitung sebagai biaya sewa. Kontrak sewa dibuat oleh admin.
			</p>
		</div>

		{#if sukses}
			<div class="rounded-lg px-3 py-2 text-xs font-semibold flex items-center gap-1.5" style="background: #dcfce7; color: #166534" data-testid="sk-sukses">
				<IconCheck size={14} /> {sukses}
			</div>
		{/if}

		{#if loading}
			<CircularProgressGauge size={50} strokeWidth={4} label="Memuat kontrak sewa keluar..." />
		{:else if loadError}
			<div class="rounded-xl p-4 text-xs" style="background: #fef2f2; color: #b91c1c">{loadError}</div>
		{:else if rows.length === 0}
			<div class="rounded-xl p-6 text-center" style="background: var(--sys-fill2); border: 1px solid var(--sys-sep)" data-testid="sk-kosong">
				<IconTruckDelivery size={32} class="mx-auto mb-2" style="color: var(--sys-label3)" />
				<p class="text-sm font-semibold" style="color: var(--sys-label)">Belum ada kontrak sewa keluar aktif</p>
				<p class="text-xs mt-1" style="color: var(--sys-label3)">
					Kontrak sewa dibuat admin dari Sales Order rental (menu Rental di dashboard admin). Setelah kontrak aktif, alatnya muncul di sini.
				</p>
			</div>
		{:else}
			{#each rows as row (row.contract_id)}
				<div class="rounded-xl p-3 border-l-4" style="background: #ecfeff; border-color: #0891b2;" data-testid="sk-kontrak">
					<p class="text-sm font-bold truncate" style="color: #155e75">{row.customer_name}</p>
					<p class="text-xs mt-0.5" style="color: var(--sys-label3)">
						{row.nomor_so} · {row.project_name}{row.jenis_alat ? ` · ${row.jenis_alat}` : ''}{row.tipe_tagihan ? ` · tagihan ${row.tipe_tagihan.replace('_', ' ')}` : ''}
					</p>

					{#if row.paket}
						<div class="flex items-center gap-1.5 mt-2 text-xs font-semibold" style="color: {warnaPaket[row.paket.status]}" data-testid="sk-paket">
							<IconGauge size={14} />
							Jam paket terpakai {row.paket.terpakai} dari {row.hour_meter_limit} jam —
							{row.paket.sisa > 0 ? `sisa ${row.paket.sisa} jam` : `LEWAT ${Math.abs(row.paket.sisa)} jam (kelebihan ditagih terpisah)`}
						</div>
					{/if}
					<p class="text-[11px] mt-1" style="color: var(--sys-label3)">
						{row.jumlah_entri} entri timesheet · terakhir {fmtTgl(row.tanggal_terakhir)}{row.last_hour_meter != null ? ` · hour meter terakhir ${row.last_hour_meter}` : ''}
					</p>

					{#if openId === row.contract_id}
						<div class="mt-3 space-y-2" data-testid="sk-form">
							<div class="grid grid-cols-3 gap-2">
								<div>
									<p class="text-[10px] font-semibold mb-0.5" style="color: var(--sys-label3)">Tanggal</p>
									<input type="date" class="f-input w-full text-xs" max={hariIni()} bind:value={form.tanggal} />
								</div>
								<div>
									<p class="text-[10px] font-semibold mb-0.5" style="color: var(--sys-label3)">Jam mulai</p>
									<input type="time" class="f-input w-full text-xs" bind:value={form.jam_mulai} />
								</div>
								<div>
									<p class="text-[10px] font-semibold mb-0.5" style="color: var(--sys-label3)">Jam selesai</p>
									<input type="time" class="f-input w-full text-xs" bind:value={form.jam_selesai} />
								</div>
							</div>
							<div class="grid grid-cols-2 gap-2">
								<div>
									<p class="text-[10px] font-semibold mb-0.5" style="color: var(--sys-label3)">Hour meter akhir shift</p>
									<input type="number" inputmode="decimal" step="0.1" min="0" class="f-input w-full text-xs" placeholder={row.last_hour_meter != null ? `≥ ${row.last_hour_meter}` : 'opsional'} bind:value={form.hm} />
								</div>
								<div>
									<p class="text-[10px] font-semibold mb-0.5" style="color: var(--sys-label3)">Lembur (jam)</p>
									<input type="number" inputmode="decimal" step="0.5" min="0" class="f-input w-full text-xs" placeholder="opsional" bind:value={form.lembur} />
								</div>
							</div>
							<div class="grid grid-cols-2 gap-2">
								<div>
									<p class="text-[10px] font-semibold mb-0.5" style="color: var(--sys-label3)">BBM solar (liter)</p>
									<input type="number" inputmode="decimal" step="0.1" min="0" class="f-input w-full text-xs" placeholder="opsional" bind:value={form.bbm_liter} />
								</div>
								<div>
									<p class="text-[10px] font-semibold mb-0.5" style="color: var(--sys-label3)">BBM (Rp)</p>
									<input type="number" inputmode="numeric" step="1000" min="0" class="f-input w-full text-xs" placeholder="opsional" bind:value={form.bbm_rp} />
								</div>
							</div>
							<FieldHint text="Isi BBM HANYA bila solar alat ini ditanggung Eltama hari itu. Kosongkan bila ditanggung customer. Hour meter tidak boleh lebih kecil dari catatan sebelumnya." />
							<textarea class="f-input w-full text-xs" rows="2" placeholder="Catatan (opsional): kendala, area belum siap, dll." bind:value={form.catatan}></textarea>

							{#if errors.length}
								<ul class="text-xs list-disc list-inside" style="color: #b91c1c" data-testid="sk-errors">
									{#each errors as e}<li>{e}</li>{/each}
								</ul>
							{/if}
							<div class="flex gap-2">
								<button type="button" class="px-3 py-1.5 rounded-lg text-xs font-semibold text-white flex items-center gap-1" style="background: #0891b2" disabled={saving} onclick={() => simpan(row)} data-testid="sk-simpan">
									{#if saving}<IconLoader2 size={14} class="animate-spin" />{/if}
									Simpan Timesheet
								</button>
								<button type="button" class="px-3 py-1.5 rounded-lg text-xs font-semibold" style="background: var(--sys-fill); color: var(--sys-label)" onclick={() => (openId = null)}>Batal</button>
							</div>
						</div>
					{:else}
						<button type="button" class="mt-2 text-xs font-semibold" style="color: #0891b2" onclick={() => buka(row.contract_id)} data-testid="sk-catat">+ Catat Timesheet</button>
					{/if}
				</div>
			{/each}
		{/if}
	</div>
</div>
