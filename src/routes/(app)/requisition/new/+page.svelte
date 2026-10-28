<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { IconArrowLeft, IconPlus, IconTrash, IconLoader2, IconAlertCircle } from '@tabler/icons-svelte';
	import { getProjects } from '$lib/services/projects';
	import { submitRequisition, searchIdentitasBarang, fetchEquivalentSuggestions } from '$lib/services/requisitionApi';
	// Fase 3 (rencana Draf Otomatis Universal v2) — rute pilot Lapis 1.
	import { autoDraft, clearAutoDraft } from '$lib/utils/autoDraft';
	import FormDraftBar from '$lib/components/shared/FormDraftBar.svelte';
	import KnowledgeCard from '$lib/components/inventory360/KnowledgeCard.svelte';

	type ItemRow = {
		identitas_barang_id: number | null;
		nama_barang: string;
		quantity_requested: number | null;
		units: string;
		estimated_unit_price: number | null;
		searchQuery: string;
		searchResults: any[];
		searching: boolean;
		kode_item?: string | null;
		item_group_id?: string | null;
		equivalentSuggestions?: any[];
	};

	function newRow(): ItemRow {
		return {
			identitas_barang_id: null,
			nama_barang: '',
			quantity_requested: null,
			units: '',
			estimated_unit_price: null,
			searchQuery: '',
			searchResults: [],
			searching: false,
			kode_item: null,
			item_group_id: null,
			equivalentSuggestions: []
		};
	}

	let requisitionType = $state<'project_material' | 'general_internal'>('general_internal');
	let projects = $state<any[]>([]);
	let projectId = $state<number | null>(null);
	let tujuanPenggunaan = $state('');
	let tanggalDibutuhkan = $state('');
	let destinationPicName = $state('');
	// F5.2 — tandai mendesak → WA ke rantai approval + GM.
	let urgent = $state(false);
	let urgentReason = $state('');
	let items = $state<ItemRow[]>([newRow()]);

	let submitting = $state(false);
	let error = $state<string | null>(null);
	let loadingProjects = $state(false);
	// Fase 3 (rencana Draf Otomatis Universal v2) — banner pemulihan Lapis 1.
	let draftRestoreInfo = $state<{ savedAt: number | null; apply: () => void; discard: () => void } | null>(null);

	onMount(async () => {
		loadingProjects = true;
		try {
			const res = await getProjects(null, true, null, { limit: 200 });
			projects = res?.data || res || [];
		} catch {
			projects = [];
		} finally {
			loadingProjects = false;
		}
	});

	function addRow() {
		items = [...items, newRow()];
	}

	function removeRow(idx: number) {
		items = items.filter((_, i) => i !== idx);
	}

	let searchTimers: Record<number, ReturnType<typeof setTimeout>> = {};

	function onSearchInput(idx: number) {
		clearTimeout(searchTimers[idx]);
		searchTimers[idx] = setTimeout(async () => {
			const row = items[idx];
			if (!row) return;
			row.searching = true;
			items = [...items];
			try {
				row.searchResults = await searchIdentitasBarang(row.searchQuery);
			} catch {
				row.searchResults = [];
			} finally {
				row.searching = false;
				items = [...items];
			}
		}, 300);
	}

	function pickItem(idx: number, barang: any) {
		const row = items[idx];
		row.identitas_barang_id = barang.id;
		row.nama_barang = barang.nama_barang_lengkap;
		row.units = barang.satuan || '';
		row.estimated_unit_price = parseFloat(barang.harga_beli) || 0;
		row.searchQuery = barang.nama_barang_lengkap;
		row.searchResults = [];
		row.kode_item = barang.kode_item || null;
		row.item_group_id = barang.item_group_id || null;
		row.equivalentSuggestions = [];
		items = [...items];
		maybeSuggestEquivalents(idx, barang);
	}

	async function maybeSuggestEquivalents(idx: number, barang: any) {
		const stok = parseFloat(barang.stok_tersedia) || 0;
		if (stok > 0 || !barang.item_group_id) return;
		const suggestions = await fetchEquivalentSuggestions(barang.item_group_id, barang.id);
		if (suggestions.length > 0) {
			items[idx].equivalentSuggestions = suggestions;
			items = [...items];
		}
	}

	function swapToSuggestion(idx: number, suggestion: any) {
		pickItem(idx, suggestion);
	}

	function dismissSuggestions(idx: number) {
		items[idx].equivalentSuggestions = [];
		items = [...items];
	}

	function totalAmount() {
		return items.reduce((sum, it) => sum + (it.quantity_requested || 0) * (it.estimated_unit_price || 0), 0);
	}

	function formatCurrency(v: number) {
		return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(v || 0);
	}

	async function handleSubmit() {
		error = null;
		if (requisitionType === 'project_material' && !projectId) {
			error = 'Pilih proyek terlebih dahulu untuk pengajuan material proyek.';
			return;
		}
		const validItems = items.filter((it) => (it.identitas_barang_id || it.nama_barang.trim()) && (it.quantity_requested || 0) > 0);
		if (!validItems.length) {
			error = 'Minimal 1 item dengan jumlah > 0 wajib diisi.';
			return;
		}
		if (urgent && !urgentReason.trim()) {
			error = 'Isi alasan mendesak — akan dikirim ke rantai approval & GM lewat WhatsApp.';
			return;
		}

		submitting = true;
		try {
			const result = await submitRequisition({
				requisitionType,
				projectId: requisitionType === 'project_material' ? projectId : null,
				tujuanPenggunaan,
				tanggalDibutuhkan: tanggalDibutuhkan || null,
				destinationPicName,
				urgent,
				urgentReason: urgent ? urgentReason.trim() : null,
				items: validItems.map((it) => ({
					identitas_barang_id: it.identitas_barang_id,
					nama_barang: it.nama_barang || null,
					quantity_requested: it.quantity_requested,
					units: it.units,
					estimated_unit_price: it.estimated_unit_price
				}))
			});
			clearAutoDraft('requisition-new');
			goto(`/requisition/${result.requisitionId}`);
		} catch (e: any) {
			error = e?.message || 'Gagal mengirim pengajuan';
		} finally {
			submitting = false;
		}
	}
</script>

<div class="p-4 max-w-2xl mx-auto pb-24">
	<button class="flex items-center gap-1 text-sm text-gray-500 mb-3" onclick={() => goto('/requisition')}>
		<IconArrowLeft size={18} /> Kembali
	</button>
	<h1 class="text-lg font-semibold mb-4">Pengajuan Barang Baru</h1>

	{#if error}
		<div class="flex items-center gap-2 bg-red-50 text-red-700 p-3 rounded-lg text-sm mb-4">
			<IconAlertCircle size={18} /> {error}
		</div>
	{/if}

	<FormDraftBar
		restoreInfo={draftRestoreInfo}
		onApplied={() => (draftRestoreInfo = null)}
	/>

	<div
		class="space-y-4"
		data-draft-scope="requisition-new"
		use:autoDraft={{ onRestoreAvailable: (info) => (draftRestoreInfo = info) }}
	>
		<div>
			<label class="text-sm font-medium block mb-1" for="req-type">Tipe Pengajuan</label>
			<div class="grid grid-cols-2 gap-2">
				<button
					id="req-type"
					class="border rounded-lg py-2 text-sm font-medium {requisitionType === 'general_internal' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600'}"
					onclick={() => (requisitionType = 'general_internal')}
				>
					Kebutuhan Internal
				</button>
				<button
					class="border rounded-lg py-2 text-sm font-medium {requisitionType === 'project_material' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600'}"
					onclick={() => (requisitionType = 'project_material')}
				>
					Material Proyek
				</button>
			</div>
		</div>

		{#if requisitionType === 'project_material'}
			<div>
				<label class="text-sm font-medium block mb-1" for="proyek">Proyek</label>
				<select id="proyek" class="w-full border rounded-lg p-2 text-sm" bind:value={projectId} disabled={loadingProjects}>
					<option value={null}>-- Pilih Proyek --</option>
					{#each projects as p (p.id)}
						<option value={p.id}>{p.name}</option>
					{/each}
				</select>
			</div>
		{/if}

		<div>
			<label class="text-sm font-medium block mb-1" for="tujuan">Tujuan Penggunaan</label>
			<textarea id="tujuan" class="w-full border rounded-lg p-2 text-sm" rows="2" bind:value={tujuanPenggunaan}></textarea>
		</div>

		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class="text-sm font-medium block mb-1" for="tanggal">Tanggal Dibutuhkan</label>
				<input id="tanggal" type="date" class="w-full border rounded-lg p-2 text-sm" bind:value={tanggalDibutuhkan} />
			</div>
			<div>
				<label class="text-sm font-medium block mb-1" for="pic">PIC Penerima</label>
				<input id="pic" type="text" class="w-full border rounded-lg p-2 text-sm" bind:value={destinationPicName} />
			</div>
		</div>

		<!-- F5.2 — tandai mendesak -->
		<div class="rounded-lg border border-amber-200 bg-amber-50 p-3">
			<label class="flex items-start gap-2 text-sm font-medium text-amber-900">
				<input type="checkbox" class="mt-0.5" bind:checked={urgent} />
				<span>
					Pengajuan mendesak
					<span class="block text-xs font-normal text-amber-700">Mengirim notifikasi WhatsApp ke rantai approval &amp; General Manager. Gunakan hanya untuk kebutuhan yang benar-benar tidak bisa menunggu.</span>
				</span>
			</label>
			{#if urgent}
				<textarea
					class="mt-2 w-full border border-amber-300 rounded-lg p-2 text-sm bg-white"
					rows="2"
					placeholder="Alasan mendesak (wajib) — ikut dikirim ke approver & GM"
					bind:value={urgentReason}
				></textarea>
			{/if}
		</div>

		<div>
			<div class="flex items-center justify-between mb-2">
				<span class="text-sm font-medium">Item Barang</span>
				<button class="flex items-center gap-1 text-blue-600 text-sm" onclick={addRow}>
					<IconPlus size={16} /> Tambah item
				</button>
			</div>
			<div class="space-y-3">
				{#each items as row, idx (idx)}
					<div class="border rounded-lg p-3 relative">
						{#if items.length > 1}
							<button class="absolute top-2 right-2 text-red-500" onclick={() => removeRow(idx)}>
								<IconTrash size={16} />
							</button>
						{/if}
						<div class="relative mb-2">
							<input
								type="text"
								placeholder="Cari barang atau ketik nama bebas (ATK dll)"
								class="w-full border rounded-lg p-2 text-sm"
								bind:value={row.searchQuery}
								oninput={() => {
									row.nama_barang = row.searchQuery;
									row.identitas_barang_id = null;
									onSearchInput(idx);
								}}
							/>
							{#if row.searching}
								<IconLoader2 class="animate-spin absolute right-2 top-2.5 text-gray-400" size={16} />
							{/if}
							{#if row.searchResults.length > 0}
								<div class="absolute z-10 bg-white border rounded-lg shadow-lg w-full mt-1 max-h-48 overflow-y-auto">
									{#each row.searchResults as barang (barang.id)}
										<button
											class="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b last:border-b-0"
											onclick={() => pickItem(idx, barang)}
										>
											{barang.nama_barang_lengkap}
											{#if barang.kode_item}<span class="text-xs font-mono font-bold text-emerald-600 ml-1">{barang.kode_item}</span>{/if}
											<span class="text-xs text-gray-400">(stok: {barang.stok_tersedia ?? 0})</span>
										</button>
									{/each}
								</div>
							{/if}
						</div>
						{#if row.identitas_barang_id}
							<!-- Inventory 360°: spek & panduan beli untuk barang yang dipilih -->
							<div class="mb-2"><KnowledgeCard itemId={row.identitas_barang_id} context="purchase" label="Panduan barang" /></div>
						{/if}
						{#if row.equivalentSuggestions && row.equivalentSuggestions.length > 0}
							<div class="mb-2 p-2 border border-amber-300 bg-amber-50 rounded-lg text-xs">
								<div class="flex items-center justify-between mb-1">
									<span class="font-semibold text-amber-800">⚠️ Stok kosong — alternatif setara tersedia:</span>
									<button class="text-amber-500" onclick={() => dismissSuggestions(idx)}>✕</button>
								</div>
								<div class="space-y-1">
									{#each row.equivalentSuggestions as sug (sug.id)}
										<button
											type="button"
											class="w-full text-left px-2 py-1 bg-white border border-amber-200 rounded hover:bg-amber-100 flex items-center justify-between gap-2"
											onclick={() => swapToSuggestion(idx, sug)}
										>
											<span class="truncate">
												{sug.nama_barang_lengkap}
												{#if sug.kode_item}<span class="font-mono text-amber-700 ml-1">{sug.kode_item}</span>{/if}
											</span>
											<span class="text-emerald-600 font-semibold shrink-0">stok: {sug.stok_tersedia}</span>
										</button>
									{/each}
								</div>
							</div>
						{/if}
						<div class="grid grid-cols-3 gap-2">
							<div>
								<label class="text-xs text-gray-500" for={`qty-${idx}`}>Jumlah</label>
								<input id={`qty-${idx}`} type="number" min="0" class="w-full border rounded-lg p-1.5 text-sm" bind:value={row.quantity_requested} />
							</div>
							<div>
								<label class="text-xs text-gray-500" for={`unit-${idx}`}>Satuan</label>
								<input id={`unit-${idx}`} type="text" class="w-full border rounded-lg p-1.5 text-sm" bind:value={row.units} />
							</div>
							<div>
								<label class="text-xs text-gray-500" for={`price-${idx}`}>Est. Harga/Satuan</label>
								<input id={`price-${idx}`} type="number" min="0" class="w-full border rounded-lg p-1.5 text-sm" bind:value={row.estimated_unit_price} />
							</div>
						</div>
					</div>
				{/each}
			</div>
		</div>

		<div class="flex items-center justify-between border-t pt-3">
			<span class="text-sm text-gray-500">Estimasi Total</span>
			<span class="text-base font-semibold">{formatCurrency(totalAmount())}</span>
		</div>

		<button
			class="w-full bg-blue-600 text-white rounded-lg py-3 text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
			onclick={handleSubmit}
			disabled={submitting}
		>
			{#if submitting}
				<IconLoader2 class="animate-spin" size={18} />
			{/if}
			Ajukan
		</button>
	</div>
</div>
