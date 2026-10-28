<script lang="ts">
	import { createAdendum } from '$lib/services/timelineAdendum';
	import { IconX, IconLoader2 } from '@tabler/icons-svelte';

	let {
		open = $bindable(false),
		projectId,
		requestedByName,
		directusToken = null,
		plannedActivities = { metadata: {}, categories: [] },
		preselected = null,
		onSubmitted = () => {}
	}: {
		open: boolean;
		projectId: number;
		requestedByName: string;
		directusToken?: string | null;
		plannedActivities: any;
		preselected?: { category: any; subtask: any } | null;
		onSubmitted?: () => void;
	} = $props();

	const ALASAN_UMUM = ['Cuaca buruk', 'Material terlambat', 'Manpower kurang', 'Alat rusak', 'Menunggu persetujuan klien', 'Lainnya (isi manual)'];

	let selectedCatId = $state('');
	let selectedSubId = $state('');
	let shiftDays = $state(1);
	let volSubBaru = $state('');
	let alasanPreset = $state('');
	let alasanManual = $state('');
	let catatanDampakBiaya = $state('');
	let saving = $state(false);
	let errorMsg = $state('');

	$effect(() => {
		if (open) {
			if (preselected) {
				selectedCatId = preselected.category?.id || '';
				selectedSubId = preselected.subtask?.id || '';
			} else if (!selectedCatId && plannedActivities?.categories?.length > 0) {
				selectedCatId = plannedActivities.categories[0].id;
				selectedSubId = plannedActivities.categories[0].subtasks?.[0]?.id || '';
			}
		}
	});

	let categories = $derived(plannedActivities?.categories || []);
	let selectedCat = $derived(categories.find((c: any) => c.id === selectedCatId) || null);
	let subtasksOfCat = $derived(selectedCat?.subtasks || []);
	let selectedSub = $derived(subtasksOfCat.find((s: any) => s.id === selectedSubId) || null);

	$effect(() => {
		if (selectedSub) volSubBaru = String(selectedSub.volume ?? '');
	});

	function getLastPlanDate(sub: any): string | null {
		const keys = Object.keys(sub?.daily_plan || {}).filter((k) => sub.daily_plan[k] > 0);
		if (keys.length === 0) return null;
		return keys.sort().at(-1) || null;
	}

	function shiftDateKey(dateKey: string, days: number): string {
		const d = new Date(dateKey);
		d.setDate(d.getDate() + days);
		const y = d.getFullYear();
		const m = String(d.getMonth() + 1).padStart(2, '0');
		const dd = String(d.getDate()).padStart(2, '0');
		return `${y}-${m}-${dd}`;
	}

	function resetForm() {
		selectedCatId = '';
		selectedSubId = '';
		shiftDays = 1;
		volSubBaru = '';
		alasanPreset = '';
		alasanManual = '';
		catatanDampakBiaya = '';
		errorMsg = '';
	}

	function close() {
		open = false;
		resetForm();
	}

	async function handleSubmit() {
		errorMsg = '';
		const alasanFinal = alasanPreset === 'Lainnya (isi manual)' || !alasanPreset ? alasanManual.trim() : alasanPreset;

		if (!selectedSub) {
			errorMsg = 'Pilih Task/Subtask yang akan direvisi';
			return;
		}
		if (!alasanFinal) {
			errorMsg = 'Alasan wajib diisi';
			return;
		}
		if (!shiftDays || shiftDays === 0) {
			errorMsg = 'Isi jumlah hari pergeseran jadwal';
			return;
		}

		saving = true;
		try {
			const snapshotBefore = JSON.parse(JSON.stringify(plannedActivities));
			const proposedChanges = JSON.parse(JSON.stringify(plannedActivities));

			const catIdx = proposedChanges.categories.findIndex((c: any) => c.id === selectedCatId);
			const subIdx = proposedChanges.categories[catIdx]?.subtasks?.findIndex((s: any) => s.id === selectedSubId);
			if (catIdx === -1 || subIdx === -1 || subIdx === undefined) {
				throw new Error('Subtask tidak ditemukan pada data timeline saat ini');
			}
			const targetSub = proposedChanges.categories[catIdx].subtasks[subIdx];

			const oldLastPlanDate = getLastPlanDate(targetSub);
			const oldVolume = targetSub.volume;

			const newDailyPlan: Record<string, number> = {};
			Object.entries(targetSub.daily_plan || {}).forEach(([dateKey, val]) => {
				const hasActual = (targetSub.daily_actual || {})[dateKey] > 0;
				const newKey = hasActual ? dateKey : shiftDateKey(dateKey, shiftDays);
				newDailyPlan[newKey] = val as number;
			});
			targetSub.daily_plan = newDailyPlan;

			if (volSubBaru !== '' && parseFloat(volSubBaru) !== parseFloat(oldVolume)) {
				targetSub.volume = parseFloat(volSubBaru);
			}

			const newLastPlanDate = getLastPlanDate(targetSub);

			const diffSummary = {
				task: selectedCat?.name,
				subtask: selectedSub.name,
				shiftDays,
				oldLastPlanDate,
				newLastPlanDate,
				oldVolume,
				newVolume: targetSub.volume
			};

			const res = await createAdendum({
				projectId,
				directusToken,
				requestedByName,
				snapshotBefore,
				proposedChanges,
				diffSummary,
				alasan: alasanFinal,
				catatanDampakBiaya: catatanDampakBiaya.trim() || null
			});

			if (res.success) {
				onSubmitted();
				close();
			} else {
				errorMsg = res.error || 'Gagal membuat pengajuan';
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
				<h3>📝 Ajukan Adendum Timeline</h3>
				<button class="sheet-close" onclick={close}><IconX size={20} /></button>
			</div>

			<div class="sheet-body">
				<label class="field-label" for="cat-select">Task</label>
				<select id="cat-select" bind:value={selectedCatId} onchange={() => (selectedSubId = subtasksOfCat[0]?.id || '')}>
					{#each categories as cat}
						<option value={cat.id}>{cat.name}</option>
					{/each}
				</select>

				<label class="field-label" for="sub-select">Subtask</label>
				<select id="sub-select" bind:value={selectedSubId}>
					{#each subtasksOfCat as sub}
						<option value={sub.id}>{sub.name || '(tanpa nama)'}</option>
					{/each}
				</select>

				{#if selectedSub}
					<div class="current-info">
						Jadwal Plan berakhir: <strong>{getLastPlanDate(selectedSub) || '-'}</strong><br />
						Vol Sub saat ini: <strong>{selectedSub.volume} {selectedSub.unit}</strong>
					</div>
				{/if}

				<label class="field-label" for="shift-input">Geser Jadwal (hari)</label>
				<input id="shift-input" type="number" bind:value={shiftDays} placeholder="mis. 3 (mundur) / -2 (maju)" />

				<label class="field-label" for="vol-input">Vol Sub Baru (opsional)</label>
				<input id="vol-input" type="number" step="0.01" bind:value={volSubBaru} />

				<label class="field-label" for="alasan-select">Alasan <span class="required">*</span></label>
				<select id="alasan-select" bind:value={alasanPreset}>
					<option value="">-- Pilih Alasan --</option>
					{#each ALASAN_UMUM as a}
						<option value={a}>{a}</option>
					{/each}
				</select>
				{#if alasanPreset === 'Lainnya (isi manual)' || !alasanPreset}
					<textarea bind:value={alasanManual} rows="2" placeholder="Tulis alasan secara manual"></textarea>
				{/if}

				<label class="field-label" for="biaya-input">Catatan Dampak Biaya (opsional)</label>
				<textarea id="biaya-input" bind:value={catatanDampakBiaya} rows="2" placeholder="Dampak ke biaya/RAB — tidak mengubah RAB otomatis"></textarea>

				{#if errorMsg}
					<div class="error-msg">{errorMsg}</div>
				{/if}
			</div>

			<div class="sheet-footer">
				<button class="btn-cancel" onclick={close} disabled={saving}>Batal</button>
				<button class="btn-submit" onclick={handleSubmit} disabled={saving}>
					{#if saving}<IconLoader2 size={16} class="animate-spin" />{/if}
					{saving ? 'Mengirim...' : 'Ajukan'}
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
	select, input, textarea {
		width: 100%; padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 10px;
		font-size: 13px; box-sizing: border-box; font-family: inherit; background: #f8fafc;
	}
	.current-info { font-size: 12px; color: #475569; background: #f0fdf4; padding: 8px 10px; border-radius: 10px; margin-top: 8px; line-height: 1.5; }
	.error-msg { font-size: 12px; color: #dc2626; background: #fef2f2; padding: 8px 10px; border-radius: 10px; margin-top: 12px; }
	.sheet-footer { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid #f1f5f9; }
	.btn-cancel, .btn-submit {
		flex: 1; padding: 12px; border-radius: 12px; font-size: 14px; font-weight: 600; cursor: pointer; border: none;
		display: flex; align-items: center; justify-content: center; gap: 6px;
	}
	.btn-cancel { background: #f1f5f9; color: #475569; }
	.btn-submit { background: var(--g, #16a34a); color: white; }
	.btn-cancel:disabled, .btn-submit:disabled { opacity: 0.6; }
</style>
