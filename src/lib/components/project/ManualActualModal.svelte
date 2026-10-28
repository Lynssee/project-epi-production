<script lang="ts">
	import { createManualActual } from '$lib/services/timelineManualActual';
	import { IconX, IconLoader2 } from '@tabler/icons-svelte';

	let {
		open = $bindable(false),
		projectId,
		categoryId,
		categoryName,
		subtaskId,
		subtaskName,
		volume,
		unit,
		inputByName,
		inputByKaryawanId = null,
		onSubmitted = () => {}
	}: {
		open: boolean;
		projectId: number;
		categoryId: string;
		categoryName: string;
		subtaskId: string;
		subtaskName: string;
		volume: number;
		unit: string;
		inputByName: string;
		inputByKaryawanId?: number | null;
		onSubmitted?: (tanggal: string, value: number) => void;
	} = $props();

	function todayKey(): string {
		const d = new Date();
		const m = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		return `${d.getFullYear()}-${m}-${day}`;
	}

	let tanggal = $state(todayKey());
	let progressValue = $state<number | ''>('');
	let catatan = $state('');
	let saving = $state(false);
	let errorMsg = $state('');

	$effect(() => {
		if (open) {
			tanggal = todayKey();
			progressValue = '';
			catatan = '';
			errorMsg = '';
		}
	});

	function close() {
		if (saving) return;
		open = false;
	}

	async function handleSubmit() {
		errorMsg = '';
		if (!tanggal) {
			errorMsg = 'Pilih tanggal actual';
			return;
		}
		const val = Number(progressValue);
		if (!val || val <= 0) {
			errorMsg = 'Isi jumlah progress lebih dari 0';
			return;
		}
		saving = true;
		try {
			const res = await createManualActual({
				projectId,
				categoryId,
				categoryName,
				subtaskId,
				subtaskName,
				tanggal,
				progressValue: val,
				inputByName,
				inputByKaryawanId,
				catatan: catatan.trim() || null
			});
			if (res.success) {
				onSubmitted(tanggal, val);
				open = false;
			} else {
				errorMsg = res.error || 'Gagal menyimpan input actual';
			}
		} catch (err: any) {
			errorMsg = err?.message || 'Terjadi kesalahan';
		} finally {
			saving = false;
		}
	}
</script>

{#if open}
	<div class="sheet-overlay" onclick={close} role="presentation">
		<div class="sheet-content" onclick={(e) => e.stopPropagation()} role="dialog">
			<div class="sheet-handle"></div>
			<div class="sheet-header">
				<h3>✏️ Isi Actual Manual</h3>
				<button class="sheet-close" onclick={close}><IconX size={20} /></button>
			</div>

			<div class="sheet-body">
				<div class="current-info">
					<strong>{subtaskName}</strong><br />
					Volume: {volume || 0} {unit || 'ls'}
				</div>

				<p class="hint-text">Input sementara — dipakai selagi alur laporan harian per-subtask belum tersedia. Nilai akan ditambahkan ke Actual yang sudah ada.</p>

				<label class="field-label" for="ma-date">Tanggal <span class="required">*</span></label>
				<input id="ma-date" type="date" bind:value={tanggal} />

				<label class="field-label" for="ma-value">Jumlah Progress ({unit || 'ls'}) <span class="required">*</span></label>
				<input id="ma-value" type="number" min="0" step="any" bind:value={progressValue} placeholder="cth. 10" />

				<label class="field-label" for="ma-note">Catatan (opsional)</label>
				<textarea id="ma-note" bind:value={catatan} rows="2" placeholder="Detail tambahan..."></textarea>

				{#if errorMsg}
					<div class="error-msg">{errorMsg}</div>
				{/if}
			</div>

			<div class="sheet-footer">
				<button class="btn-cancel" onclick={close} disabled={saving}>Batal</button>
				<button class="btn-submit" onclick={handleSubmit} disabled={saving}>
					{#if saving}<IconLoader2 size={16} class="animate-spin" />{/if}
					{saving ? 'Menyimpan...' : 'Simpan'}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.sheet-overlay {
		position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); z-index: 1000;
		display: flex; align-items: flex-end; justify-content: center;
	}
	.sheet-content {
		background: white; width: 100%; max-width: 480px; border-radius: 20px 20px 0 0;
		max-height: 88vh; display: flex; flex-direction: column; overflow: hidden;
	}
	.sheet-handle { width: 36px; height: 4px; background: #d1d5db; border-radius: 2px; margin: 10px auto 0; }
	.sheet-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid #f1f5f9; }
	.sheet-header h3 { margin: 0; font-size: 15px; font-weight: 700; color: #1e293b; }
	.sheet-close { background: none; border: none; color: #64748b; padding: 4px; }
	.sheet-body { padding: 14px 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
	.field-label { font-size: 12px; font-weight: 600; color: #374151; margin-top: 12px; margin-bottom: 4px; }
	.required { color: #dc2626; }
	input, textarea {
		width: 100%; padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 10px;
		font-size: 13px; box-sizing: border-box; font-family: inherit; background: #f8fafc;
	}
	.current-info { font-size: 12px; color: #475569; background: #eff6ff; padding: 8px 10px; border-radius: 10px; margin-top: 8px; line-height: 1.5; }
	.hint-text { font-size: 11px; color: #94a3b8; margin: 8px 0 4px; line-height: 1.4; }
	.error-msg { font-size: 12px; color: #dc2626; background: #fef2f2; padding: 8px 10px; border-radius: 10px; margin-top: 12px; }
	.sheet-footer { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid #f1f5f9; }
	.btn-cancel, .btn-submit {
		flex: 1; padding: 12px; border-radius: 12px; font-size: 14px; font-weight: 600; cursor: pointer; border: none;
		display: flex; align-items: center; justify-content: center; gap: 6px;
	}
	.btn-cancel { background: #f1f5f9; color: #475569; }
	.btn-submit { background: #2563eb; color: white; }
	.btn-cancel:disabled, .btn-submit:disabled { opacity: 0.6; }

	:global(:root[data-theme='dark']) .sheet-content { background: var(--sys-bg2, #1B2530); }
	:global(:root[data-theme='dark']) .sheet-header { border-color: var(--sys-sep, #2B3844); }
	:global(:root[data-theme='dark']) .sheet-header h3 { color: var(--sys-label, #fff); }
	:global(:root[data-theme='dark']) .sheet-close { color: var(--sys-label3, #94a3b8); }
	:global(:root[data-theme='dark']) .field-label { color: var(--sys-label2, #cbd5e1); }
	:global(:root[data-theme='dark']) input,
	:global(:root[data-theme='dark']) textarea {
		background: var(--sys-fill, #232F3B); border-color: var(--sys-sep, #2B3844); color: var(--sys-label, #fff);
	}
	:global(:root[data-theme='dark']) .current-info { background: rgba(37, 99, 235, 0.15); color: var(--sys-label2, #cbd5e1); }
	:global(:root[data-theme='dark']) .hint-text { color: var(--sys-label4, #64748b); }
	:global(:root[data-theme='dark']) .sheet-footer { border-color: var(--sys-sep, #2B3844); }
	:global(:root[data-theme='dark']) .btn-cancel { background: var(--sys-fill, #232F3B); color: var(--sys-label2, #cbd5e1); }
</style>
