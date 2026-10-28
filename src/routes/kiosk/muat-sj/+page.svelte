<script lang="ts">
	// src/routes/kiosk/muat-sj/+page.svelte
	// Kiosk Gudang — Muat Barang: scan QR SJ → foto muatan → tahap `dimuat`.
	// Tracking SJ v2 Fase 3c. Sesi kiosk badge+PIN.
	import { goto } from '$app/navigation';
	import { parseEpiQr } from '$lib/utils/qrParse';
	import { prepareKioskPhoto } from '$lib/kiosk/kioskPhoto';
	import { IconArrowLeft, IconQrcode, IconCamera, IconCheck, IconLoader2, IconAlertTriangle } from '@tabler/icons-svelte';

	let QrScannerModal = $state<any>(null);
	async function loadScanner() {
		QrScannerModal ??= (await import('$lib/components/scanner/QrScannerModal.svelte')).default;
	}
	let showScanner = $state(false);
	let err = $state('');
	let info = $state('');

	let sjId = $state<number | null>(null);
	let sjNomor = $state('');
	let fotoFile = $state<File | null>(null);
	let fotoPreview = $state<string | null>(null);
	let catatan = $state('');
	let submitting = $state(false);
	let clientEventId = $state('');

	function reset() {
		sjId = null; sjNomor = '';
		if (fotoPreview) URL.revokeObjectURL(fotoPreview);
		fotoFile = null; fotoPreview = null; catatan = '';
		clientEventId = `kiosk-muat-${crypto.randomUUID()}`;
	}
	reset();

	function onScanDetect(raw: string) {
		showScanner = false;
		const parsed = parseEpiQr(raw);
		if (!parsed || parsed.type !== 'SJ') { err = 'Itu bukan QR Surat Jalan.'; return; }
		err = ''; info = '';
		sjId = Number(parsed.id);
		sjNomor = `SJ #${parsed.id}`;
	}

	let fotoProcessing = $state(false);
	async function pickFoto(e: Event) {
		const f = (e.target as HTMLInputElement).files?.[0];
		if (!f) return;
		fotoProcessing = true;
		try {
			const small = await prepareKioskPhoto(f);
			if (fotoPreview) URL.revokeObjectURL(fotoPreview);
			fotoFile = small;
			fotoPreview = URL.createObjectURL(small);
		} catch (e2) {
			err = e2 instanceof Error ? e2.message : 'Foto gagal diproses.';
		} finally {
			fotoProcessing = false;
		}
	}

	async function submit() {
		if (!sjId || submitting || fotoProcessing) return;
		if (!fotoFile) { err = 'Foto muatan dari belakang kendaraan wajib — satu foto cukup.'; return; }
		submitting = true; err = '';
		try {
			const fd = new FormData();
			fd.append('sjId', String(sjId));
			fd.append('client_event_id', clientEventId);
			if (catatan.trim()) fd.append('catatan', catatan.trim());
			fd.append('foto', fotoFile);
			const res = await fetch('/api/kiosk/muat-sj', { method: 'POST', body: fd });
			const d = await res.json().catch(() => null);
			if (!res.ok) throw new Error(d?.message || 'Gagal mencatat muat.');
			info = d?.masuk_antrian_satpam ? `${sjNomor} tercatat dimuat — sekarang masuk antrian satpam di gerbang.` : `${sjNomor} tercatat: barang sudah dimuat.`;
			reset();
		} catch (e) {
			err = e instanceof Error ? e.message : 'Gagal.';
		} finally {
			submitting = false;
		}
	}
</script>

<div class="wrap">
	<button class="back" onclick={() => goto('/kiosk/home')}><IconArrowLeft size={18} /> Kembali</button>
	<h1>Muat Barang</h1>
	<p class="hint" title="SJ harus sudah dicetak admin. Setelah foto tersimpan, SJ otomatis masuk antrian satpam bila kategorinya butuh pemeriksaan gerbang.">Scan QR Surat Jalan <b>yang sudah dicetak</b>, lalu foto seluruh muatan dari belakang kendaraan. Satu foto cukup. Setelah tersimpan, SJ otomatis masuk antrian satpam bila perlu.</p>

	{#if err}<div class="banner err"><IconAlertTriangle size={18} /> {err}</div>{/if}
	{#if info}<div class="banner ok"><IconCheck size={18} /> {info}</div>{/if}

	{#if !sjId}
		<button class="scan-btn" onclick={async () => { await loadScanner(); err = ''; showScanner = true; }}>
			<IconQrcode size={40} /> Scan QR Surat Jalan
		</button>
	{:else}
		<div class="card">
			<div class="sjno">{sjNomor}</div>
			<label class="foto-btn" class:has={!!fotoPreview}>
				<IconCamera size={20} />
				{fotoPreview ? 'Foto tersimpan — ganti?' : 'Foto muatan (wajib)'}
				<input type="file" accept="image/*" capture="environment" onchange={pickFoto} hidden />
			</label>
			{#if fotoPreview}<img class="foto-prev" src={fotoPreview} alt="Muatan" />{/if}
			<textarea rows="2" placeholder="Catatan (opsional)" bind:value={catatan}></textarea>
			<div class="actions">
				<button class="batal" onclick={reset} disabled={submitting}>Batal</button>
				<button class="ok" onclick={submit} disabled={submitting || fotoProcessing}>
					{#if submitting}<IconLoader2 size={20} class="spin" />{:else}<IconCheck size={20} />{/if}
					Simpan — Dimuat
				</button>
			</div>
		</div>
	{/if}
</div>

{#if showScanner && QrScannerModal}
	<QrScannerModal expectedPrefix="EPI:SJ:" onDetect={onScanDetect} onClose={() => (showScanner = false)} />
{/if}

<style>
	.wrap { max-width: 560px; margin: 0 auto; padding: 1rem; }
	.back { display: inline-flex; align-items: center; gap: 0.35rem; background: none; border: none; color: #475569; font-size: 0.9rem; margin-bottom: 0.5rem; }
	h1 { font-size: 1.5rem; margin: 0 0 0.25rem; }
	.hint { font-size: 0.85rem; color: #64748b; margin: 0 0 1rem; }
	.banner { display: flex; align-items: center; gap: 0.5rem; padding: 0.6rem 0.75rem; border-radius: 0.6rem; font-size: 0.85rem; margin-bottom: 0.6rem; }
	.banner.err { background: #fef2f2; color: #b91c1c; }
	.banner.ok { background: #f0fdf4; color: #15803d; }
	.scan-btn { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 0.5rem; padding: 1.75rem; border: 2px dashed #94a3b8; border-radius: 1rem; background: #f8fafc; color: #334155; font-size: 1rem; font-weight: 600; }
	.card { border: 1px solid #e2e8f0; border-radius: 1rem; padding: 1rem; background: #fff; }
	.sjno { font-size: 1.25rem; font-weight: 700; margin-bottom: 0.75rem; }
	.foto-btn { display: flex; align-items: center; gap: 0.5rem; padding: 0.85rem; border: 2px dashed #cbd5e1; border-radius: 0.75rem; font-size: 0.9rem; color: #475569; cursor: pointer; }
	.foto-btn.has { border-color: #16a34a; border-style: solid; color: #16a34a; }
	.foto-prev { width: 100%; max-height: 180px; object-fit: cover; border-radius: 0.5rem; margin-top: 0.5rem; }
	textarea { width: 100%; margin-top: 0.6rem; padding: 0.6rem; border: 1px solid #cbd5e1; border-radius: 0.6rem; font-size: 0.9rem; resize: vertical; }
	.actions { display: flex; gap: 0.6rem; margin-top: 0.9rem; }
	.batal, .ok { flex: 1; display: flex; align-items: center; justify-content: center; gap: 0.4rem; padding: 1rem; border: none; border-radius: 0.75rem; font-size: 1rem; font-weight: 700; }
	.batal { background: #f1f5f9; color: #475569; }
	.ok { background: #16a34a; color: #fff; }
	.ok:disabled { background: #cbd5e1; }
	:global(.spin) { animation: spin 1s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
</style>
