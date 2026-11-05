<!-- src/lib/components/project/FieldIssueReportModal.svelte -->
<!-- Modal Cepat Lapor Kendala Darurat (SOS Lapangan) untuk Mandor / Leader Site -->
<script lang="ts">
	import { fade, slide } from 'svelte/transition';
	import { reportFieldIssue, type ProjectActionItem } from '$lib/services/projectActionApi';
	import {
		IconAlertTriangle,
		IconCamera,
		IconX,
		IconLoader2,
		IconPhoto,
		IconFlame,
		IconSend,
		IconCopy,
		IconCheck
	} from '@tabler/icons-svelte';

	interface Props {
		projectId: number;
		actor: { id: string; nama: string };
		onClose: () => void;
		onSuccess: (created: ProjectActionItem) => void;
	}

	let { projectId, actor, onClose, onSuccess }: Props = $props();

	let judul = $state('');
	let deskripsi = $state('');
	let jenisKendala = $state('alat_rusak');
	let dampak = $state<ProjectActionItem['dampak']>('pekerjaan_terhenti');
	let selectedPhotos = $state<File[]>([]);
	let photoPreviews = $state<string[]>([]);
	let submitting = $state(false);
	let errorMsg = $state('');
	let createdItem = $state<ProjectActionItem | null>(null);
	let copiedWa = $state(false);

	const JENIS_KENDALA_OPTIONS = [
		{ value: 'alat_rusak', label: 'Kompresor / Alat Kerja Rusak / Breakdown' },
		{ value: 'material_habis', label: 'Material Cat / Thinner / Pasir Kurang / Rusak' },
		{ value: 'cuaca_buruk', label: 'Cuaca Ekstrim / Hujan / Kelembaban Tinggi' },
		{ value: 'akses_klien', label: 'Akses Lokasi Ditutup / Ijin Klien Tertahan' },
		{ value: 'safety_issue', label: 'Insiden Keselamatan / Kondisi Bahaya (K3)' },
		{ value: 'komplain_klien', label: 'Komplain / Perintah Stop dari Pengawas Klien' },
		{ value: 'lainnya', label: 'Kendala Operasional Lainnya' }
	];

	function handlePhotoSelect(e: Event) {
		const input = e.target as HTMLInputElement;
		if (!input.files || input.files.length === 0) return;

		const files = Array.from(input.files);
		selectedPhotos = [...selectedPhotos, ...files];

		files.forEach((file) => {
			const reader = new FileReader();
			reader.onload = (ev) => {
				if (ev.target?.result) {
					photoPreviews = [...photoPreviews, ev.target.result as string];
				}
			};
			reader.readAsDataURL(file);
		});
	}

	function removePhoto(index: number) {
		selectedPhotos = selectedPhotos.filter((_, i) => i !== index);
		photoPreviews = photoPreviews.filter((_, i) => i !== index);
	}

	function getWaText(item: ProjectActionItem) {
		const urgencyLabel =
			item.tingkat_urgensi === 'kritis_darurat' || item.tingkat_urgensi === 'kritis'
				? '🚨 KRITIS (PEKERJAAN TERHENTI)'
				: '⚠️ RISIKO KETERLAMBATAN';
		return `🚨 *LAPORAN KENDALA SITE (SOS)* 🚨\n*No. Dokumen:* ${item.nomor_dokumen}\n*Status Dampak:* ${urgencyLabel}\n*Masalah:* ${item.judul}\n*Keterangan:* ${item.deskripsi}\n*Pelapor:* ${actor.nama}\n\n_Mohon koordinasi & bantuan segera dari kantor/tim terkait._`;
	}

	function shareToWhatsApp(item: ProjectActionItem) {
		const text = encodeURIComponent(getWaText(item));
		window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank');
	}

	function copyWaText(item: ProjectActionItem) {
		navigator.clipboard.writeText(getWaText(item));
		copiedWa = true;
		setTimeout(() => (copiedWa = false), 2500);
	}

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (!judul.trim()) {
			errorMsg = 'Judul kendala wajib diisi';
			return;
		}
		if (!deskripsi.trim()) {
			errorMsg = 'Keterangan kendala wajib diisi';
			return;
		}

		submitting = true;
		errorMsg = '';

		const isCritical = dampak === 'pekerjaan_terhenti';
		const urgency = isCritical ? 'kritis_darurat' : 'tinggi';

		try {
			const created = await reportFieldIssue(projectId, {
				judul: judul.trim(),
				deskripsi: deskripsi.trim(),
				dampak,
				tingkat_urgensi: urgency,
				pembuat_id: actor.id,
				pembuat_nama: actor.nama,
				photoFiles: selectedPhotos
			});
			createdItem = created;
			onSuccess(created);
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal melaporkan kendala';
		} finally {
			submitting = false;
		}
	}
</script>

<div
	class="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs"
	transition:fade={{ duration: 150 }}
>
	<div
		class="bg-white dark:bg-slate-900 w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden max-h-[92vh] flex flex-col"
		transition:slide={{ duration: 200 }}
	>
		<!-- Header -->
		<div class="p-4 border-b border-slate-200 dark:border-slate-800 bg-rose-50 dark:bg-rose-950/40 flex items-center justify-between">
			<div class="flex items-center gap-2">
				<div class="w-8 h-8 rounded-full bg-rose-600 text-white flex items-center justify-center text-sm font-bold animate-pulse">
					⚠️
				</div>
				<div>
					<h3 class="text-xs font-bold text-rose-900 dark:text-rose-200 uppercase tracking-wider">
						Lapor Kendala Urgent (SOS Site)
					</h3>
					<p class="text-[11px] text-rose-700 dark:text-rose-300">
						Eskalasi darurat ke manajemen & kantor pusat
					</p>
				</div>
			</div>
			<button
				type="button"
				onclick={onClose}
				class="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-700 flex items-center justify-center"
			>
				<IconX size={16} />
			</button>
		</div>

		<!-- TAMPILAN JIKA SUDAH BERHASIL DILAPORKAN (POST-SUBMIT WA ACTION) -->
		{#if createdItem}
			<div class="p-6 text-center space-y-4">
				<div class="w-14 h-14 mx-auto rounded-full bg-emerald-500/20 text-emerald-500 flex items-center justify-center text-2xl font-bold">
					✓
				</div>
				<div>
					<h4 class="text-base font-bold text-slate-800 dark:text-white">Kendala Berhasil Dicatat!</h4>
					<p class="text-xs text-slate-500 dark:text-slate-400 mt-1">
						Nomor Tiket: <span class="font-mono font-bold text-slate-700 dark:text-slate-200">{createdItem.nomor_dokumen}</span>
					</p>
					<p class="text-xs text-slate-500 dark:text-slate-400 mt-1">
						Admin dan tim manajemen proyek telah menerima kendala ini di sistem.
					</p>
				</div>

				<div class="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-left text-xs">
					<div class="font-bold text-slate-700 dark:text-slate-200 mb-1 flex items-center gap-1.5">
						<span>📢 Bagikan Cepat ke WhatsApp Tim:</span>
					</div>
					<div class="text-[11px] text-slate-600 dark:text-slate-300 font-mono line-clamp-3 bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-200 dark:border-slate-700">
						{getWaText(createdItem)}
					</div>
				</div>

				<div class="pt-2 flex flex-col gap-2">
					<button
						type="button"
						onclick={() => shareToWhatsApp(createdItem!)}
						class="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md shadow-emerald-950/20 transition active:scale-95"
					>
						<IconSend size={16} />
						<span>Kirim ke WhatsApp Tim</span>
					</button>

					<button
						type="button"
						onclick={() => copyWaText(createdItem!)}
						class="w-full inline-flex items-center justify-center gap-2 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-xs transition"
					>
						{#if copiedWa}
							<IconCheck size={15} class="text-emerald-500" />
							<span>Format WA Tersalin!</span>
						{:else}
							<IconCopy size={15} />
							<span>Salin Format Teks</span>
						{/if}
					</button>

					<button
						type="button"
						onclick={onClose}
						class="w-full py-2 text-slate-400 hover:text-slate-600 text-xs font-medium transition"
					>
						Tutup
					</button>
				</div>
			</div>
		{:else}
			<!-- Body Form -->
			<form onsubmit={handleSubmit} class="p-4 space-y-3.5 overflow-y-auto flex-1 text-xs">
				<!-- Dampak Lapangan (Paling Atas & Mencolok) -->
				<div>
					<div class="block font-bold text-slate-800 dark:text-slate-100 mb-1.5">
						Apakah Pekerjaan Terhenti? <span class="text-rose-500">*</span>
					</div>
					<div class="grid grid-cols-2 gap-2">
						<button
							type="button"
							onclick={() => (dampak = 'pekerjaan_terhenti')}
							class="p-2.5 rounded-xl border text-left transition flex items-center gap-2 {dampak === 'pekerjaan_terhenti'
								? 'bg-rose-50 border-rose-500 text-rose-900 dark:bg-rose-950/60 dark:text-rose-200 font-bold ring-2 ring-rose-500/20'
								: 'border-slate-200 dark:border-slate-700 hover:bg-slate-50'}"
						>
							<span class="text-base">🛑</span>
							<div>
								<div class="text-xs">Stop Work</div>
								<div class="text-[10px] text-slate-400 font-normal">Pekerjaan terhenti total</div>
							</div>
						</button>

						<button
							type="button"
							onclick={() => (dampak = 'risiko_delay')}
							class="p-2.5 rounded-xl border text-left transition flex items-center gap-2 {dampak === 'risiko_delay'
								? 'bg-amber-50 border-amber-500 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200 font-bold ring-2 ring-amber-500/20'
								: 'border-slate-200 dark:border-slate-700 hover:bg-slate-50'}"
						>
							<span class="text-base">⚠️</span>
							<div>
								<div class="text-xs">Melambat</div>
								<div class="text-[10px] text-slate-400 font-normal">Risiko terlambat</div>
							</div>
						</button>
					</div>
				</div>

				<!-- Jenis Kendala -->
				<div>
					<label for="jenis-kendala-select" class="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
						Jenis Masalah
					</label>
					<select
						id="jenis-kendala-select"
						bind:value={jenisKendala}
						class="w-full text-xs p-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-rose-500"
					>
						{#each JENIS_KENDALA_OPTIONS as opt}
							<option value={opt.value}>{opt.label}</option>
						{/each}
					</select>
				</div>

				<!-- Judul Kendala Singkat -->
				<div>
					<label for="field-issue-title" class="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
						Judul Kendala Singkat <span class="text-rose-500">*</span>
					</label>
					<input
						id="field-issue-title"
						type="text"
						placeholder="Contoh: Kompresor PDS-390 oli bocor, tekanan drop"
						bind:value={judul}
						class="w-full text-xs p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-rose-500"
						required
					/>
				</div>

				<!-- Detail Kronologi & Permintaan Bantuan -->
				<div>
					<label for="field-issue-desc" class="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
						Keterangan & Tindakan yang Dibutuhkan <span class="text-rose-500">*</span>
					</label>
					<textarea
						id="field-issue-desc"
						rows={3}
						placeholder="Jelaskan kondisi saat ini dan bantuan yang dibutuhkan segera dari pusat/manajemen..."
						bind:value={deskripsi}
						class="w-full text-xs p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-rose-500"
						required
					></textarea>
				</div>

				<!-- Foto Bukti dari Kamera HP -->
				<div>
					<div class="block font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
						Foto Bukti Kendala di Lapangan
					</div>

					<div class="flex items-center gap-2 flex-wrap">
						<!-- Camera Button Direct -->
						<label
							class="cursor-pointer inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold transition active:scale-95"
						>
							<IconCamera size={16} />
							<span>Buka Kamera HP</span>
							<input
								type="file"
								accept="image/*"
								capture="environment"
								class="hidden"
								onchange={handlePhotoSelect}
							/>
						</label>

						<!-- Gallery Upload -->
						<label
							class="cursor-pointer inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold transition active:scale-95"
						>
							<IconPhoto size={16} />
							<span>Galeri</span>
							<input
								type="file"
								accept="image/*"
								multiple
								class="hidden"
								onchange={handlePhotoSelect}
							/>
						</label>

						<span class="text-[10px] text-slate-400">
							Foto dikompres otomatis (&lt;0.8MB)
						</span>
					</div>

					<!-- Thumbnail Preview List -->
					{#if photoPreviews.length > 0}
						<div class="flex gap-2 overflow-x-auto mt-2.5 pb-1">
							{#each photoPreviews as preview, idx}
								<div class="relative w-16 h-16 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 shrink-0 group">
									<img src={preview} alt="Preview Bukti" class="w-full h-full object-cover" />
									<button
										type="button"
										onclick={() => removePhoto(idx)}
										class="absolute top-1 right-1 bg-black/70 hover:bg-rose-600 text-white rounded-full p-0.5 transition"
										title="Hapus foto"
									>
										<IconX size={12} />
									</button>
								</div>
							{/each}
						</div>
					{/if}
				</div>

				{#if errorMsg}
					<div class="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs">
						{errorMsg}
					</div>
				{/if}

				<!-- Footer Actions -->
				<div class="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
					<button
						type="button"
						onclick={onClose}
						disabled={submitting}
						class="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition font-medium"
					>
						Batal
					</button>

					<button
						type="submit"
						disabled={submitting}
						class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-bold shadow-md shadow-rose-950/20 transition active:scale-95"
					>
						{#if submitting}
							<IconLoader2 size={16} class="animate-spin" />
							<span>Mengirim SOS...</span>
						{:else}
							<IconFlame size={16} />
							<span>Kirim Laporan Kendala</span>
						{/if}
					</button>
				</div>
			</form>
		{/if}
	</div>
</div>
