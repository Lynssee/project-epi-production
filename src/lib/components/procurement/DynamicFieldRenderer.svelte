<!-- src/lib/components/procurement/DynamicFieldRenderer.svelte
     Fase 3 (Pertajam Pengajuan Pembelian v2, 23 Agu 2026): render field custom dari
     purchase_category_config.form_schema (schema gabungan induk+anak). Versi Svelte 5 runes
     project-epi — kontrak JSON sama dengan versi erp-epi-1, ditulis terpisah (lihat rencana
     Bab 6.1). Tipe: text, textarea, number, currency, date, select, boolean, image, lookup
     (lookup dikunci ke source 'assets'/'karyawan'). -->
<script lang="ts">
	import { secureDirectusFetch } from '$lib/services/secureDirectus';

	let { schema = [], values = $bindable({}) }: { schema: any[]; values: Record<string, any> } = $props();

	let lookupOptions: Record<string, { id: number; label: string }[]> = $state({});
	let searchTimers: Record<string, ReturnType<typeof setTimeout>> = {};

	async function searchLookup(field: any, query: string) {
		clearTimeout(searchTimers[field.key]);
		if (!query || query.length < 2) {
			lookupOptions = { ...lookupOptions, [field.key]: [] };
			return;
		}
		searchTimers[field.key] = setTimeout(async () => {
			try {
				const coll = field.source === 'karyawan' ? 'karyawan' : 'assets';
				const labelField = field.source === 'karyawan' ? 'nama_karyawan' : 'name';
				const res = await secureDirectusFetch(
					`/items/${coll}?filter[${labelField}][_icontains]=${encodeURIComponent(query)}&fields=id,${labelField}&limit=10`
				);
				const json = await res.json();
				lookupOptions = {
					...lookupOptions,
					[field.key]: (json.data || []).map((r: any) => ({ id: r.id, label: r[labelField] }))
				};
			} catch (e) {
				console.warn('[DynamicFieldRenderer] gagal cari lookup:', e);
			}
		}, 300);
	}
</script>

{#if schema.length > 0}
	<div class="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
		<p class="text-xs font-semibold text-slate-500">Detail Tambahan</p>
		{#each schema as field (field.key)}
			<div>
				<label for="dfr-{field.key}" class="block text-xs font-medium mb-1" style="color: var(--sys-label3)">
					{field.label || field.key}{field.required ? ' *' : ''}
				</label>

				{#if field.type === 'text'}
					<input id="dfr-{field.key}" type="text" bind:value={values[field.key]} class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
				{:else if field.type === 'textarea'}
					<textarea id="dfr-{field.key}" bind:value={values[field.key]} rows="2" class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm"></textarea>
				{:else if field.type === 'number' || field.type === 'currency'}
					<div class="flex items-center gap-2">
						{#if field.type === 'currency'}<span class="text-sm text-slate-400">Rp</span>{/if}
						<input id="dfr-{field.key}" type="number" bind:value={values[field.key]} min={field.min ?? undefined} class="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
						{#if field.suffix}<span class="text-sm text-slate-400">{field.suffix}</span>{/if}
					</div>
				{:else if field.type === 'date'}
					<input id="dfr-{field.key}" type="date" bind:value={values[field.key]} class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
				{:else if field.type === 'select'}
					<select id="dfr-{field.key}" bind:value={values[field.key]} class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm">
						<option value="">— Pilih —</option>
						{#each field.options || [] as opt (opt)}<option value={opt}>{opt}</option>{/each}
					</select>
				{:else if field.type === 'boolean'}
					<label class="flex items-center gap-1.5 text-sm"><input type="checkbox" bind:checked={values[field.key]} /> Ya</label>
				{:else if field.type === 'lookup'}
					<input
						type="text"
						placeholder={field.source === 'karyawan' ? 'Cari nama karyawan...' : 'Cari nama aset...'}
						oninput={(e) => searchLookup(field, (e.target as HTMLInputElement).value)}
						class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm"
					/>
					{#if lookupOptions[field.key]?.length}
						<div class="mt-1 rounded-xl border border-slate-200 max-h-32 overflow-y-auto">
							{#each lookupOptions[field.key] as opt (opt.id)}
								<button
									type="button"
									onclick={() => { values[field.key] = opt.id; lookupOptions = { ...lookupOptions, [field.key]: [] }; }}
									class="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-100"
								>{opt.label}</button>
							{/each}
						</div>
					{/if}
					{#if values[field.key]}<p class="text-[10px] text-emerald-600 mt-1">✓ Terpilih (id: {values[field.key]})</p>{/if}
				{/if}

				{#if field.hint}<p class="text-[11px] text-slate-400 mt-1">{field.hint}</p>{/if}
			</div>
		{/each}
	</div>
{/if}
