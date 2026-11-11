<!-- src/lib/components/project/LaporKaburModal.svelte -->
<!-- Modal Lapangan untuk Pelaporan Manpower Kabur / Mangkir Fatal (Fase 2) -->
<script lang="ts">
	import { fade, slide } from 'svelte/transition';
	import { IconAlertTriangle, IconLoader2, IconX, IconShieldAlert } from '@tabler/icons-svelte';
	import { laporManpowerKabur } from '$lib/services/manpowerAssignment';

	let {
		show = false,
		assignment = null,
		pelaporNama = 'Project Leader',
		onSuccess = () => {},
		onClose = () => {}
	} = $props<{
		show: boolean;
		assignment: any;
		pelaporNama?: string;
		onSuccess?: () => void;
		onClose?: () => void;
	}>();

	let sisaKasbon = $state<number>(0);
	let catatan = $state<string>('');
	let tanggalTerakhir = $state<string>(new Date().toISOString().split('T')[0]);
	let confirmed = $state<boolean>(false);
	let submitting = $state<boolean>(false);
	let errorMsg = $state<string>('');

	let workerName = $derived(
		assignment?.manpower_id && typeof assignment.manpower_id === 'object'
			? assignment.manpower_id.nama || 'Tanpa Nama'
			: assignment?.ttd_nama || `#${assignment?.manpower_id || '-'}`
	);

	let workerNik = $derived(
		assignment?.manpower_id && typeof assignment.manpower_id === 'object'
			? assignment.manpower_id.NIK || '-'
			: '-'
	);

	let projectName = $derived(
		assignment?.project_id && typeof assignment.project_id === 'object'
			? assignment.project_id.name || `Proyek #${assignment.project_id.id}`
			: `Proyek #${assignment?.project_id || '-'}`
	);

	async function handleSubmit() {
		if (!confirmed) {
			errorMsg = 'Anda wajib mencentang konfirmasi pertanggungjawaban pelaporan.';
			return;
		}
		if (!catatan || catatan.trim().length < 5) {
			errorMsg = 'Isi kronologi atau alasan lengkap (minimal 5 karakter).';
			return;
		}

		submitting = true;
		errorMsg = '';
		try {
			const mpId =
				assignment?.manpower_id && typeof assignment.manpower_id === 'object'
					? assignment.manpower_id.id
					: assignment?.manpower_id;

			const prjId =
				assignment?.project_id && typeof assignment.project_id === 'object'
					? assignment.project_id.id
					: assignment?.project_id;

			const fullCatatan = `Tanggal terakhir terlihat: ${tanggalTerakhir}. Kronologi: ${catatan.trim()}${
				sisaKasbon > 0 ? ` (Sisa Kasbon Tertunggak: Rp ${sisaKasbon.toLocaleString('id-ID')})` : ''
			}`;

			const res = await laporManpowerKabur({
				assignmentId: Number(assignment.id),
				manpowerId: Number(mpId),
				projectId: Number(prjId),
				pelaporNama,
				catatan: fullCatatan,
				sisaKasbon: Number(sisaKasbon) || 0
			});

			if (res.success) {
				if (typeof window !== 'undefined' && (window as any).__showToast) {
					(window as any).__showToast(
						`Pekerja ${workerName} berhasil dilaporkan kabur dan NIK telah di-blacklist.`,
						'success'
					);
				}
				onSuccess();
				onClose();
			} else {
				errorMsg = res.error || 'Gagal memproses laporan pekerja kabur.';
			}
		} catch (err: any) {
			errorMsg = err?.message || 'Terjadi kesalahan sistem saat melapor.';
		} finally {
			submitting = false;
		}
	}
</script>

{#if show && assignment}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
		in:fade={{ duration: 150 }}
	>
		<div
			class="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto border border-rose-200 dark:border-rose-950/50"
			in:slide={{ duration: 200 }}
		>
			<!-- Header -->
			<div class="flex items-center justify-between px-6 py-4 border-b border-rose-100 dark:border-rose-950/60 bg-rose-50 dark:bg-rose-950/30">
				<div class="flex items-center gap-2.5 text-rose-600 dark:text-rose-400">
					<div class="p-2 rounded-xl bg-rose-500/15">
						<IconShieldAlert size={22} />
					</div>
					<div>
						<h3 class="text-base font-bold leading-tight">Lapor Manpower Kabur / Fatal</h3>
						<p class="text-xs text-rose-700/80 dark:text-rose-300/80 mt-0.5">
							Tindakan ini akan mem-blacklist NIK pekerja dan menyiarkan peringatan.
						</p>
					</div>
				</div>
				<button
					type="button"
					onclick={onClose}
					class="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
				>
					<IconX size={18} />
				</button>
			</div>

			<!-- Body -->
			<div class="p-6 space-y-4 text-[13px]">
				<!-- Ringkasan Pekerja -->
				<div class="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/60 space-y-1.5">
					<div class="flex justify-between">
						<span class="text-gray-500 dark:text-gray-400">Nama Pekerja:</span>
						<span class="font-bold text-gray-900 dark:text-white">{workerName}</span>
					</div>
					<div class="flex justify-between">
						<span class="text-gray-500 dark:text-gray-400">NIK KTP:</span>
						<span class="font-semibold text-gray-700 dark:text-gray-300">{workerNik}</span>
					</div>
					<div class="flex justify-between">
						<span class="text-gray-500 dark:text-gray-400">Nomor SPK:</span>
						<span class="font-mono text-gray-700 dark:text-gray-300">{assignment.nomor_spk || '-'}</span>
					</div>
					<div class="flex justify-between">
						<span class="text-gray-500 dark:text-gray-400">Lokasi Proyek:</span>
						<span class="text-gray-800 dark:text-gray-200">{projectName}</span>
					</div>
				</div>

				<!-- Tanggal Terakhir Hadir -->
				<div>
					<label class="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase mb-1">
						Tanggal Terakhir Masuk / Terlihat *
					</label>
					<input
						type="date"
						bind:value={tanggalTerakhir}
						class="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-rose-500"
					/>
				</div>

				<!-- Sisa Kasbon -->
				<div>
					<label class="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase mb-1">
						Estimasi Sisa Kasbon / Uang Muka yang Belum Kembali (Rp)
					</label>
					<input
						type="number"
						bind:value={sisaKasbon}
						min="0"
						step="10000"
						placeholder="0"
						class="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-rose-500"
					/>
					<p class="text-[11px] text-gray-400 mt-1">Kosongkan atau isi 0 jika tidak ada tanggungan kasbon.</p>
				</div>

				<!-- Kronologi / Alasan -->
				<div>
					<label class="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase mb-1">
						Kronologi Kejadian & Alasan *
					</label>
					<textarea
						bind:value={catatan}
						rows="3"
						placeholder="Contoh: Pekerja izin pulang hari Sabtu, dijanjikan masuk Senin namun tidak hadir dan nomor telepon tidak aktif. Rekan kerja menginfokan pindah ke proyek luar..."
						class="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-rose-500"
					></textarea>
				</div>

				<!-- Peringatan Sistem -->
				<div class="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 text-xs space-y-1">
					<p class="font-bold flex items-center gap-1">
						<IconAlertTriangle size={14} />
						Dampak Eksekusi Laporan:
					</p>
					<ul class="list-disc list-inside space-y-0.5 pl-1 opacity-90 text-[12px]">
						<li>SPK ini otomatis ditutup dengan status <em>kabur_mangkir</em>.</li>
						<li>NIK pekerja langsung diblokir (*Hard Blacklist*) di seluruh proyek & workshop.</li>
						<li>Webhook n8n akan mengirim siaran peringatan ke grup pengawas proyek & manajemen.</li>
					</ul>
				</div>

				<!-- Checkbox Konfirmasi -->
				<label class="flex items-start gap-2.5 p-3 rounded-xl border border-rose-300/60 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/20 cursor-pointer select-none">
					<input
						type="checkbox"
						bind:checked={confirmed}
						class="mt-0.5 rounded text-rose-600 focus:ring-rose-500 cursor-pointer"
					/>
					<span class="text-xs text-rose-900 dark:text-rose-200 leading-snug">
						Saya menyatakan bahwa pekerja ini benar-benar telah meninggalkan site/pekerjaan tanpa izin resmi dan data yang saya laporkan dapat dipertanggungjawabkan.
					</span>
				</label>

				{#if errorMsg}
					<div class="p-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs font-medium">
						{errorMsg}
					</div>
				{/if}
			</div>

			<!-- Footer Actions -->
			<div class="px-6 py-4 border-t border-gray-200 dark:border-slate-800 flex justify-end gap-2.5">
				<button
					type="button"
					onclick={onClose}
					disabled={submitting}
					class="px-4 py-2 text-xs font-semibold text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 rounded-xl disabled:opacity-50"
				>
					Batal
				</button>
				<button
					type="button"
					onclick={handleSubmit}
					disabled={submitting || !confirmed}
					class="px-5 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-sm disabled:opacity-50 flex items-center gap-1.5"
				>
					{#if submitting}
						<IconLoader2 size={14} class="animate-spin" /> Memproses...
					{:else}
						<IconShieldAlert size={14} /> Eksekusi Blacklist & Broadcast
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}
