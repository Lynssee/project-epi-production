<!-- src/lib/components/anggaran/GateFixBapBorongan.svelte -->
<!-- Phased Gate Enforcement, Fase 4 tambahan — "Unggah BAP sekarang" langsung dari kartu gate
     G_BAP_BORONGAN yang gagal, tanpa pindah ke Proyek → Manpower → Borongan. Memakai jalur
     YANG SUDAH ADA (manpowerBorongan.verifyTermin: kompres foto → /api/directus/files →
     termin 'draft' jadi 'verified' + foto + catatan + % progres), bukan write baru.
     Hanya termin berstatus 'draft' yang bisa diverifikasi (aturan verifyTermin). Termin
     pelunasan tetap butuh konfirmasi aset oleh Admin ERP — tidak dilewati di sini.
     Anti Aturan #5: <input type=file capture> dipicu klik user langsung, tanpa await sebelumnya. -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { getBoronganAssignments, getBoronganTermins, verifyTermin, type BoronganTermin } from '$lib/services/manpowerBorongan';

	let {
		open = false,
		projectId,
		onClose = () => {},
		onSuccess = () => {}
	}: {
		open?: boolean;
		projectId: number | string | null;
		onClose?: () => void;
		onSuccess?: () => void;
	} = $props();

	type Opt = { termin: BoronganTermin; pekerja: string };

	let loading = $state(false);
	let options = $state<Opt[]>([]);
	let selectedId = $state<number | null>(null);
	let note = $state('');
	let progress = $state('');
	let files = $state<File[]>([]);
	let saving = $state(false);
	let errorMsg = $state('');

	// Muat termin 'draft' tiap kali dialog dibuka. Fetch dipisah per relasi (Aturan #2): assignment → termin.
	$effect(() => {
		if (!open) return;
		note = '';
		progress = '';
		files = [];
		errorMsg = '';
		selectedId = null;
		if (!projectId) {
			options = [];
			return;
		}
		loading = true;
		(async () => {
			try {
				const assignments = await getBoronganAssignments(projectId);
				const out: Opt[] = [];
				for (const a of assignments) {
					const termins = await getBoronganTermins(a.id);
					const nama = typeof a.manpower_id === 'object' ? a.manpower_id?.nama : `Manpower #${a.manpower_id}`;
					for (const t of termins) if (t.status === 'draft') out.push({ termin: t, pekerja: nama || '-' });
				}
				options = out;
				if (out.length === 1) selectedId = out[0].termin.id;
			} catch (e: any) {
				errorMsg = e?.message || 'Gagal memuat termin borongan';
				options = [];
			} finally {
				loading = false;
			}
		})();
	});

	function onFiles(e: Event) {
		files = Array.from((e.target as HTMLInputElement).files || []);
	}

	async function simpan() {
		errorMsg = '';
		if (!selectedId) { errorMsg = 'Pilih termin yang akan diverifikasi.'; return; }
		if (files.length === 0) { errorMsg = 'Lampirkan minimal 1 foto bukti progres.'; return; }
		saving = true;
		let by = 'Project Leader';
		try {
			const { auth } = await import('$lib/firebase');
			by = auth?.currentUser?.email || auth?.currentUser?.displayName || by;
		} catch { /* pakai default */ }
		const res = await verifyTermin(selectedId, {
			note,
			files,
			by,
			progressPct: progress === '' ? null : Number(progress)
		});
		saving = false;
		if (!res.success) {
			errorMsg = res.error || 'Gagal menyimpan verifikasi';
			return;
		}
		onSuccess();
		onClose();
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div role="presentation" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style="background: rgba(0,0,0,0.45)" onclick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
		<div class="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-5 flex flex-col gap-3" style="background: var(--sys-bg, #fff); max-height: 90vh; overflow-y: auto">
			<div class="flex items-center justify-between">
				<h3 class="text-[14px] font-bold" style="color: var(--sys-label)">Unggah BAP Borongan</h3>
				<button type="button" onclick={onClose} aria-label="Tutup" style="color: var(--sys-label3)">✕</button>
			</div>
			<p class="text-[11px]" style="color: var(--sys-label3)">
				Pilih termin, lalu foto kondisi pekerjaan + catatan singkat. Ini yang diperiksa gate BAP Borongan. Setelah tersimpan, syarat dicek ulang otomatis.
			</p>

			{#if errorMsg}
				<p class="text-[12px] rounded-lg p-2" style="background:#fee2e2;color:#b91c1c">{errorMsg}</p>
			{/if}

			{#if loading}
				<CircularProgressGauge size={44} strokeWidth={3} label="Memuat termin borongan..." />
			{:else if options.length === 0}
				<div class="rounded-xl p-3 text-[12px]" style="background: var(--sys-fill2, #f8fafc); color: var(--sys-label2)">
					Tidak ada termin berstatus “Direncanakan” di proyek ini. Bila BAP sudah diunggah, tekan <strong>Cek Ulang</strong>.
					Bila termin belum dibuat, Admin ERP yang menyusunnya di menu Manpower &amp; SPK.
				</div>
			{:else}
				<fieldset class="flex flex-col gap-1.5">
					<legend class="text-[11px] font-semibold mb-1" style="color: var(--sys-label2)">Termin yang diverifikasi</legend>
					{#each options as o (o.termin.id)}
						<label class="flex items-start gap-2 rounded-xl p-2 text-[12px]" style="border: 1px solid var(--sys-border, #e2e8f0)">
							<input type="radio" name="bap-termin" value={o.termin.id} bind:group={selectedId} class="mt-0.5" />
							<span><strong>{o.pekerja}</strong> — {o.termin.label}
								{#if o.termin.is_pelunasan}<em class="text-[10px]" style="color:#b45309"> · pelunasan</em>{/if}
							</span>
						</label>
					{/each}
				</fieldset>

				<label for="bap-progress" class="text-[11px] font-semibold" style="color: var(--sys-label2)">% Progres fisik saat ini (opsional)</label>
				<input id="bap-progress" type="number" min="0" max="100" bind:value={progress} placeholder="mis. 35"
					class="rounded-xl px-3 py-2 text-[13px]" style="border: 1px solid var(--sys-border, #e2e8f0); background: transparent" />

				<label for="bap-note" class="text-[11px] font-semibold" style="color: var(--sys-label2)">Catatan hasil kerja</label>
				<textarea id="bap-note" bind:value={note} rows="2" placeholder="mis. area A selesai 100%, siap lanjut area B"
					class="rounded-xl px-3 py-2 text-[13px]" style="border: 1px solid var(--sys-border, #e2e8f0); background: transparent"></textarea>

				<label for="bap-files" class="text-[11px] font-semibold" style="color: var(--sys-label2)">Foto bukti (wajib, min. 1) — otomatis dikompres</label>
				<input id="bap-files" type="file" accept="image/*" capture="environment" multiple onchange={onFiles} class="text-[11px]" />
				{#if files.length}<p class="text-[10px]" style="color: var(--sys-label3)">{files.length} foto dipilih</p>{/if}

				<button type="button" disabled={saving} onclick={simpan}
					class="mt-1 w-full rounded-xl py-2.5 text-[13px] font-bold disabled:opacity-50"
					style="background: var(--p); color: #fff">
					{saving ? 'Mengunggah…' : 'Simpan BAP'}
				</button>
			{/if}
		</div>
	</div>
{/if}
