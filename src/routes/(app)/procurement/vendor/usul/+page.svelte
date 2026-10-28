<!-- src/routes/(app)/procurement/vendor/usul/+page.svelte -->
<!--
  Usul Vendor Baru dari Lapangan — Vendor Wajib Terdaftar, Fase 7 (lapangan B2).
  Form ringkas → antrian Procurement (vendor_bayangan_log, sumber 'usul_lapangan').
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { getIdToken, secureDirectusFetch } from '$lib/services/secureDirectus';
	import { IconArrowLeft, IconPlus, IconLoader2, IconCircleCheck, IconMapPin, IconCamera } from '@tabler/icons-svelte';
	import { SectionGuide, FieldHint } from '$lib/components/hints';
	import { procurementLapanganHints } from '$lib/data/hints/procurementLapangan';
	import { getHint } from '$lib/data/hints/getHint';

	const h = (key: string) => getHint(procurementLapanganHints, key, 'procurementLapangan');

	let nama = $state('');
	let telp = $state('');
	let kota = $state('');
	let catatan = $state('');
	let gps = $state<{ lat: number; lng: number } | null>(null);
	let gpsBusy = $state(false);
	let fotoId = $state<string | null>(null);
	let fotoBusy = $state(false);
	let fotoInput: HTMLInputElement | undefined = $state();

	let submitting = $state(false);
	let done = $state(false);
	let err = $state('');

	let canSubmit = $derived(nama.trim().length >= 3 && !submitting);

	async function ambilGps() {
		gpsBusy = true;
		try {
			const pos = await new Promise<GeolocationPosition>((res, rej) =>
				navigator.geolocation.getCurrentPosition(res, rej, { timeout: 10000 })
			);
			gps = { lat: pos.coords.latitude, lng: pos.coords.longitude };
		} catch {
			err = 'Gagal mengambil lokasi GPS.';
		} finally {
			gpsBusy = false;
		}
	}

	async function onFoto(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		if (file.size > 10 * 1024 * 1024) { err = 'Foto maksimal 10 MB.'; return; }
		fotoBusy = true;
		err = '';
		try {
			const fd = new FormData();
			fd.append('file', file);
			const res = await secureDirectusFetch('/files', { method: 'POST', body: fd });
			if (!res.ok) throw new Error(`Gagal upload (${res.status})`);
			fotoId = (await res.json())?.data?.id || null;
		} catch (e: any) {
			err = 'Gagal upload foto: ' + e.message;
		} finally {
			fotoBusy = false;
		}
	}

	async function submit() {
		if (!canSubmit) return;
		submitting = true;
		err = '';
		try {
			const token = await getIdToken();
			const res = await fetch('/api/procurement/vendor-usul', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body: JSON.stringify({
					nama: nama.trim(),
					telp: telp.trim() || null,
					kota: kota.trim() || null,
					catatan: catatan.trim() || null,
					gps_lat: gps?.lat ?? null,
					gps_lng: gps?.lng ?? null,
					foto: fotoId
				})
			});
			const j = await res.json().catch(() => ({}));
			if (!res.ok) { err = j?.message || `Gagal (${res.status})`; return; }
			done = true;
		} catch (e: any) {
			err = 'Error: ' + e.message;
		} finally {
			submitting = false;
		}
	}

	function ulang() {
		done = false;
		nama = ''; telp = ''; kota = ''; catatan = '';
		gps = null; fotoId = null;
		if (fotoInput) fotoInput.value = '';
	}
</script>

<div class="flex-1 flex flex-col h-full overflow-hidden bg-slate-50">
	<div class="glass-panel border-b border-white/40 sticky top-0 z-30 shadow-sm">
		<div class="px-4 sm:px-6 py-4 flex items-center gap-3">
			<button onclick={() => goto('/procurement/vendor')} class="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-black/5 shrink-0">
				<IconArrowLeft size={20} />
			</button>
			<div class="w-10 h-10 rounded-2xl bg-teal-500 flex items-center justify-center shadow-lg shadow-teal-500/20 text-white shrink-0">
				<IconPlus size={20} />
			</div>
			<div>
				<h1 class="text-lg font-black text-slate-900 tracking-tight">Usul Vendor Baru</h1>
				<p class="text-xs font-medium" style="color: var(--sys-label3)">Toko lokal yang layak didaftarkan</p>
			</div>
		</div>
	</div>

	<div class="flex-1 overflow-y-auto px-4 sm:px-6 py-6 pb-24">
		<div class="max-w-lg mx-auto w-full space-y-4">
			<SectionGuide
				id="procurementLapangan.vendorUsul.page"
				title={h('vendorUsul.page').sectionGuide?.title}
				steps={h('vendorUsul.page').sectionGuide?.steps ?? []}
			/>

			{#if done}
				<div class="glass-panel rounded-2xl p-6 text-center space-y-3">
					<div class="w-14 h-14 mx-auto rounded-full bg-green-100 flex items-center justify-center text-green-600">
						<IconCircleCheck size={28} />
					</div>
					<h2 class="font-bold text-slate-900">Usulan terkirim</h2>
					<p class="text-sm text-slate-500">Tim Procurement akan meninjau dan mendaftarkan bila sesuai.</p>
					<button onclick={ulang} class="w-full px-4 py-2.5 text-sm font-semibold bg-teal-600 text-white rounded-xl hover:bg-teal-700">Usulkan Lagi</button>
				</div>
			{:else}
				<div class="glass-panel rounded-2xl p-5 space-y-4">
					<div>
						<label for="u-nama" class="block text-sm font-semibold text-slate-700 mb-1">Nama Toko/Vendor <span class="text-red-500">*</span></label>
						<input id="u-nama" bind:value={nama} placeholder="mis. TB Sinar Jaya" class="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-teal-400" />
					</div>
					<div class="grid grid-cols-2 gap-3">
						<div>
							<label for="u-telp" class="block text-sm font-semibold text-slate-700 mb-1">Telepon</label>
							<input id="u-telp" bind:value={telp} placeholder="08xx" class="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-teal-400" />
						</div>
						<div>
							<label for="u-kota" class="block text-sm font-semibold text-slate-700 mb-1">Kota</label>
							<input id="u-kota" bind:value={kota} class="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-teal-400" />
						</div>
					</div>
					<div>
						<label for="u-catatan" class="block text-sm font-semibold text-slate-700 mb-1">Barang/jasa yang dijual</label>
						<textarea id="u-catatan" bind:value={catatan} rows="2" placeholder="mis. besi, semen, cat, alat tukang" class="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-teal-400"></textarea>
						<FieldHint text={h('vendorUsul.form.catatan').fieldHint} />
					</div>

					<div class="flex gap-2">
						<button onclick={ambilGps} disabled={gpsBusy} class="flex-1 flex items-center justify-center gap-1 px-3 py-2.5 text-xs font-semibold border border-slate-300 rounded-xl disabled:opacity-50">
							<IconMapPin size={14} /> {gps ? 'Lokasi ✓' : gpsBusy ? 'Mengambil…' : 'Ambil Lokasi'}
						</button>
						<button onclick={() => fotoInput?.click()} disabled={fotoBusy} class="flex-1 flex items-center justify-center gap-1 px-3 py-2.5 text-xs font-semibold border border-slate-300 rounded-xl disabled:opacity-50">
							<IconCamera size={14} /> {fotoId ? 'Foto ✓' : fotoBusy ? 'Mengunggah…' : 'Foto Papan Nama'}
						</button>
						<input type="file" accept="image/*" capture="environment" bind:this={fotoInput} onchange={onFoto} class="hidden" />
					</div>

					{#if err}<div class="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-3">{err}</div>{/if}

					<button onclick={submit} disabled={!canSubmit} class="w-full px-4 py-3 text-sm font-bold bg-teal-600 text-white rounded-xl hover:bg-teal-700 disabled:opacity-50 flex items-center justify-center gap-2">
						{#if submitting}<IconLoader2 size={16} class="animate-spin" />{/if}
						{submitting ? 'Mengirim…' : 'Kirim Usulan'}
					</button>
				</div>
			{/if}
		</div>
	</div>
</div>
