<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import {
		getAllRates,
		fetchKalkulatorConfig,
		generateNomorPenawaran,
		getPenawaranById,
		savePenawaranFull,
		searchSoByNomor,
		linkPenawaranToSo,
		getSoById,
		logQuickEstimationFloorWarning,
		type QuotationHeader,
		type QuotationItem,
		type MaterialRate,
		type ResourceRate,
		type ManpowerRow
	} from '$lib/services/kalkulatorPenawaran';
	import { getCustomerOptions, getCustomerById, resolveSalesDisplayName, getSurveyEstimasiKasarMin, type CustomerOption } from '$lib/services/sales';
	import {
		SERVICE_TYPES,
		SURFACE_PREP_STANDARDS,
		SURFACE_CONDITIONS,
		APPLICATION_METHODS,
		FLOOR_SYSTEMS,
		abrasiveDefault,
		lossForMethod,
		theoreticalSpreadingRate,
		calcItem,
		calcQuotationTotals,
		type ServiceType
	} from '$lib/utils/quotationCalc';
	import { IconArrowLeft, IconLoader2, IconPlus, IconTrash, IconChevronDown, IconChevronUp } from '@tabler/icons-svelte';

	let { penawaranId = null }: { penawaranId: string | null } = $props();

	let loading = $state(true);
	let saving = $state(false);
	let errorMsg = $state('');
	let saved = $state(false);

	let materials = $state<MaterialRate[]>([]);
	let resources = $state<ResourceRate[]>([]);
	let config = $state<Record<string, any>>({});
	let customerSearch = $state('');
	let customerResults = $state<CustomerOption[]>([]);

	// Lifecycle Customer -> PO -> Komisi v2, Fase 6 (L4) — Tautkan ke SO.
	let soSearchInput = $state('');
	let soSearching = $state(false);
	let soLinkError = $state('');
	let linkedSoInfo = $state<{ id: number; nomor_so: string; customer_name: string } | null>(null);
	async function handleLinkSo() {
		if (!penawaranId) return;
		soLinkError = '';
		soSearching = true;
		try {
			const found = await searchSoByNomor(soSearchInput);
			if (!found) {
				soLinkError = `SO dengan nomor "${soSearchInput}" tidak ditemukan.`;
				return;
			}
			await linkPenawaranToSo(penawaranId, found.id);
			header.linked_so_id = found.id;
			linkedSoInfo = found;
			soSearchInput = '';
		} catch (e: any) {
			soLinkError = e?.message || 'Gagal menautkan ke SO.';
		} finally {
			soSearching = false;
		}
	}

	let header = $state<QuotationHeader>(makeDefaultHeader());
	let items = $state<QuotationItem[]>([]);
	let manpower = $state<ManpowerRow[]>([]);
	let totalDays = $state(0);
	let useManualDays = $state(false);
	let openIndex = $state<number | null>(0);

	// Fase 4 (Quick Estimasi Survey & Omnichannel) — floor dari estimasi kasar survey
	// asal (kalau ada), dibaca dari query param ?estimasi_min= (sudah dihitung & disimpan
	// saat survey, hindari fetch ulang ke Directus — non-blocking, hanya warning UI).
	let surveyEstimasiMin = $state<number | null>(null);

	const fmtRp = (v: number) => 'Rp ' + Math.round(Number(v) || 0).toLocaleString('id-ID');

	function makeDefaultHeader(): QuotationHeader {
		const today = new Date().toISOString().slice(0, 10);
		const valid = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
		return {
			nomor_penawaran: '',
			tanggal: today,
			status: 'draft',
			prospect_id: null,
			bridged_quotation_id: null,
			customer_id: null,
			kode_customer: '',
			customer_name: '',
			project_name: '',
			lokasi: '',
			valid_until: valid,
			prepared_by: '',
			payment_terms: 'DP 50% sebelum mobilisasi, pelunasan setelah serah terima.',
			mobilisasi_amount: 0,
			scaffolding_amount: 0,
			safety_amount: 0,
			overhead_pct: 5,
			margin_pct: 15,
			discount_amount: 0,
			ppn_enabled: true,
			ppn_pct: 11,
			total_area: 0,
			direct_total: 0,
			grand_total: 0,
			notes: '',
			terms: 'Harga belum termasuk pekerjaan sipil di luar lingkup.\nGaransi pekerjaan 6 bulan.',
			schedule_enabled: true,
			schedule_start_date: today,
			working_days_per_week: 6,
			mob_days: 1,
			demob_days: 1
		};
	}

	function makeDefaultItem(serviceType: ServiceType): QuotationItem {
		const inputs: Record<string, any> = {};
		if (serviceType === 'painting') inputs.coats = [];
		if (serviceType === 'floor_coating') inputs.layers = [];
		return {
			key: Math.random().toString(36).slice(2, 9),
			service_type: serviceType,
			object_name: '',
			description: '',
			area: 0,
			qty: 1,
			unit: 'm²',
			inputs
		};
	}

	onMount(async () => {
		const rates = await getAllRates();
		materials = rates.materials;
		resources = rates.resources;
		config = await fetchKalkulatorConfig();

		if (penawaranId) {
			const res = await getPenawaranById(penawaranId);
			if (res) {
				const realItems: QuotationItem[] = [];
				for (const it of res.items) {
					if (it.service_type === 'global_manpower') {
						manpower = Array.isArray(it.inputs?.manpower) ? it.inputs.manpower : [];
						totalDays = it.inputs?.total_days || 0;
						useManualDays = it.inputs?.use_manual_days || false;
					} else {
						realItems.push(it);
					}
				}
				header = res.header;
				items = realItems;
				customerSearch = header.customer_name || '';
				if (header.linked_so_id) {
					linkedSoInfo = await getSoById(header.linked_so_id);
				}
				if (header.survey_id) {
					surveyEstimasiMin = await getSurveyEstimasiKasarMin(header.survey_id);
				}
			} else {
				errorMsg = 'Penawaran tidak ditemukan.';
			}
		} else {
			header.nomor_penawaran = await generateNomorPenawaran();
			header.prepared_by = $authStore.karyawanName || resolveSalesDisplayName($authStore.user?.displayName || $authStore.user?.email) || '';

			// Read URL query params from survey / customer / prospek handover
			const params = $page.url.searchParams;
			const qCustomerId = params.get('customer_id');
			const qCustomerName = params.get('customer_name');
			const qLokasi = params.get('lokasi');
			const qLuas = params.get('luas');
			const qProject = params.get('project_name');
			const qProspectId = params.get('prospect_id');
			const qSurveyId = params.get('survey_id');
			const qEstimasiMin = params.get('estimasi_min');

			if (qProspectId && Number(qProspectId) > 0) header.prospect_id = Number(qProspectId);
			if (qSurveyId && Number(qSurveyId) > 0) header.survey_id = Number(qSurveyId);
			if (qEstimasiMin && Number(qEstimasiMin) > 0) surveyEstimasiMin = Number(qEstimasiMin);

			if (qCustomerId) {
				const cId = Number(qCustomerId);
				if (cId) {
					const cust = await getCustomerById(cId);
					if (cust) {
						pickCustomer(cust);
					}
				}
			} else if (qCustomerName) {
				header.customer_name = qCustomerName;
				customerSearch = qCustomerName;
			}

			if (qLokasi) header.lokasi = qLokasi;
			if (qProject) header.project_name = qProject;
			if (qLuas && Number(qLuas) > 0) {
				const defaultItem = makeDefaultItem('sandblasting');
				defaultItem.area = Number(qLuas);
				items = [defaultItem];
			}
		}
		loading = false;
	});

	let customerSearchTimer: ReturnType<typeof setTimeout>;
	function onCustomerSearch() {
		clearTimeout(customerSearchTimer);
		customerSearchTimer = setTimeout(async () => {
			customerResults = await getCustomerOptions(customerSearch);
		}, 300);
	}
	function pickCustomer(c: CustomerOption) {
		header.customer_id = c.id;
		header.kode_customer = c.kode_customer;
		header.customer_name = c.customer_name;
		customerSearch = c.customer_name;
		customerResults = [];
	}

	function addItem(serviceType: ServiceType) {
		items = [...items, makeDefaultItem(serviceType)];
		openIndex = items.length - 1;
	}
	function removeItem(idx: number) {
		items = items.filter((_, i) => i !== idx);
		if (openIndex === idx) openIndex = null;
	}
	function addManpowerRow() {
		manpower = [...manpower, { role: '', count: 1, dailyWage: 0 }];
	}
	function removeManpowerRow(idx: number) {
		manpower = manpower.filter((_, i) => i !== idx);
	}
	function pickLaborMaster(idx: number, resourceId: string) {
		const r = resources.find((x) => x.id === resourceId);
		if (r) {
			if (!manpower[idx].role) manpower[idx].role = r.name;
			manpower[idx].dailyWage = r.rate;
			manpower = [...manpower];
		}
	}

	function addCoat(item: QuotationItem) {
		const method = 'airless';
		item.inputs.coats = [
			...(item.inputs.coats || []),
			{ name: '', volumeSolids: 60, dft: 50, method, loss: lossForMethod(method), price: 0, thinnerPct: 0.05, thinnerPrice: 0 }
		];
		items = [...items];
	}
	function removeCoat(item: QuotationItem, idx: number) {
		item.inputs.coats = item.inputs.coats.filter((_: any, i: number) => i !== idx);
		items = [...items];
	}
	function addLayer(item: QuotationItem) {
		item.inputs.layers = [...(item.inputs.layers || []), { name: '', consumption: 0.3, wastePct: 0.05, price: 0 }];
		items = [...items];
	}
	function removeLayer(item: QuotationItem, idx: number) {
		item.inputs.layers = item.inputs.layers.filter((_: any, i: number) => i !== idx);
		items = [...items];
	}

	function applyAbrasiveStandard(item: QuotationItem) {
		const table = config?.abrasive_consumption;
		const d = table
			? table[item.inputs.surfacePrep]?.[item.inputs.surfaceCondition]
			: abrasiveDefault(item.inputs.surfacePrep, item.inputs.surfaceCondition);
		if (d > 0) item.inputs.abrasiveConsumption = d;
		items = [...items];
	}

	// Global crew headcount (dipakai untuk pembagi produktivitas — sama seperti desktop isGlobalLabor:true)
	let globalCrew = $derived(manpower.reduce((s, m) => s + (Number(m.count) || 1), 0));
	let globalDailyLabor = $derived(manpower.reduce((s, m) => s + (Number(m.count) || 1) * (Number(m.dailyWage) || 0), 0));

	let enriched = $derived(
		items.map((it) => {
			const b = calcItem(it.service_type, { ...it.inputs, area: it.area, qty: it.qty, globalCrew, isGlobalLabor: true });
			return {
				...it,
				material_cost: b.material,
				labor_cost: b.labor,
				equipment_cost: b.equipment,
				consumable_cost: b.consumable,
				subtotal: b.subtotal,
				meta: b.meta
			};
		})
	);

	let sumDays = $derived(enriched.reduce((s, it) => s + (it.meta?.days || 0), 0));
	$effect(() => {
		if (!useManualDays) totalDays = sumDays;
	});

	let globalLaborCost = $derived(totalDays * globalDailyLabor);
	let pseudoGlobalItem = $derived({
		service_type: 'global_manpower' as const,
		object_name: 'Global Manpower',
		area: 0,
		qty: 1,
		unit: 'ls',
		inputs: { manpower, total_days: totalDays, use_manual_days: useManualDays },
		material_cost: 0,
		labor_cost: globalLaborCost,
		equipment_cost: 0,
		consumable_cost: 0,
		subtotal: globalLaborCost
	});

	let totals = $derived(calcQuotationTotals([...enriched, pseudoGlobalItem], header));

	let marginWarning = $derived(header.margin_pct < 5 ? 'danger' : header.margin_pct < 10 ? 'warning' : null);

	// Fase 4 (Quick Estimasi Survey & Omnichannel) — gate G_QUICK_ESTIMATION_FLOOR (mode
	// warn, non-blocking): peringatan saja, tombol Simpan/Finalkan tetap aktif (Aturan #6).
	let floorWarning = $derived(
		surveyEstimasiMin != null && totals.grandTotal > 0 && totals.grandTotal < surveyEstimasiMin
	);

	async function save(finalize: boolean) {
		if (!enriched.length) {
			errorMsg = 'Tambahkan minimal satu item pekerjaan.';
			return;
		}
		saving = true;
		errorMsg = '';
		try {
			const payload: QuotationHeader = {
				...header,
				status: finalize ? 'final' : header.status === 'final' ? 'final' : 'draft',
				total_area: totals.totalArea,
				direct_total: totals.directTotal,
				grand_total: totals.grandTotal
			};
			const itemsPayload = [...enriched, pseudoGlobalItem] as QuotationItem[];
			const ratesSnapshot = { materials, resources, captured_at: new Date().toISOString() };
			const res = await savePenawaranFull(payload, itemsPayload, ratesSnapshot);
			penawaranId = res.id;
			header.id = res.id;
			saved = true;

			if (finalize && floorWarning && surveyEstimasiMin != null) {
				logQuickEstimationFloorWarning({
					recordId: res.id,
					method: 'PATCH',
					grandTotal: totals.grandTotal,
					floorMin: surveyEstimasiMin,
					userEmail: $authStore.user?.email || null
				});
			}
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal menyimpan penawaran.';
		} finally {
			saving = false;
		}
	}
</script>

{#if loading}
	<CircularProgressGauge size={48} strokeWidth={4} label="Memuat draft penawaran..." />
{:else if saved}
	<div class="text-center py-16">
		<p class="text-[14px] font-semibold" style="color: var(--sys-label)">Penawaran tersimpan</p>
		<p class="text-[12px] mt-1" style="color: var(--sys-label3)">{header.nomor_penawaran}</p>
		<button class="mt-5 px-4 py-2 rounded-lg text-[12px] font-semibold text-white" style="background: var(--p, var(--g))" onclick={() => goto('/sales/penawaran')}>
			Kembali ke Daftar
		</button>
	</div>
{:else}
	<div class="flex flex-col gap-4">
		<!-- Header -->
		<div class="rounded-xl border p-3.5" style="border-color: var(--sys-sep)">
			<div class="flex items-center justify-between mb-2 gap-2">
				<p class="text-[12px] font-semibold" style="color: var(--sys-label)">Data Penawaran</p>
				{#if header.prospect_id}
					<span class="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-300">
						🔗 Lead #{header.prospect_id} · sinkron ke pipeline
					</span>
				{/if}
			</div>
			<div class="flex flex-col gap-2.5">
				<div class="grid grid-cols-2 gap-2.5">
					<div>
						<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label3)">Nomor Penawaran</label>
						<input class="w-full h-10 px-3 rounded-lg border text-[13px]" style="border-color: var(--sys-sep)" bind:value={header.nomor_penawaran} />
					</div>
					<div>
						<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label3)">Dibuat Oleh</label>
						<input class="w-full h-10 px-3 rounded-lg border text-[13px]" style="border-color: var(--sys-sep)" bind:value={header.prepared_by} />
					</div>
				</div>
				<div class="relative">
					<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label3)">Customer</label>
					<input
						class="w-full h-10 px-3 rounded-lg border text-[13px]"
						style="border-color: var(--sys-sep)"
						placeholder="Cari / ketik nama customer"
						bind:value={customerSearch}
						oninput={() => { header.customer_id = null; onCustomerSearch(); }}
					/>
					{#if customerResults.length > 0}
						<div class="absolute z-10 w-full mt-1 rounded-lg border bg-white shadow-lg max-h-48 overflow-y-auto" style="border-color: var(--sys-sep)">
							{#each customerResults as c (c.id)}
								<button class="w-full text-left px-3 py-2 text-[12px] hover:bg-gray-50" onclick={() => pickCustomer(c)}>{c.customer_name}</button>
							{/each}
						</div>
					{/if}
				</div>
				<div>
					<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label3)">Kode Customer</label>
					<input class="w-full h-10 px-3 rounded-lg border text-[13px]" style="border-color: var(--sys-sep)" placeholder="Otomatis dari master customer" bind:value={header.kode_customer} />
				</div>
				<div>
					<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label3)">Nama Proyek</label>
					<input class="w-full h-10 px-3 rounded-lg border text-[13px]" style="border-color: var(--sys-sep)" bind:value={header.project_name} />
				</div>
				<div>
					<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label3)">Lokasi</label>
					<input class="w-full h-10 px-3 rounded-lg border text-[13px]" style="border-color: var(--sys-sep)" bind:value={header.lokasi} />
				</div>
				<div class="grid grid-cols-2 gap-2.5">
					<div>
						<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label3)">Tanggal</label>
						<input type="date" class="w-full h-10 px-3 rounded-lg border text-[13px]" style="border-color: var(--sys-sep)" bind:value={header.tanggal} />
					</div>
					<div>
						<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label3)">Berlaku s/d</label>
						<input type="date" class="w-full h-10 px-3 rounded-lg border text-[13px]" style="border-color: var(--sys-sep)" bind:value={header.valid_until} />
					</div>
				</div>
			</div>

			<!-- Lifecycle Customer -> PO -> Komisi v2, Fase 6 (L4) — Tautkan ke SO -->
			{#if penawaranId}
				<div class="rounded-xl border p-3" style="border-color: var(--sys-sep)">
					<p class="text-[11px] font-semibold mb-1.5" style="color: var(--sys-label3)">Deal / Tertaut ke SO</p>
					{#if linkedSoInfo}
						<div class="flex items-center gap-1.5 text-[13px] font-medium" style="color: var(--sys-label)">
							✅ {linkedSoInfo.nomor_so}
							<span class="text-[11px] font-normal" style="color: var(--sys-label3)">({linkedSoInfo.customer_name})</span>
						</div>
					{:else}
						<p class="text-[11px] mb-2" style="color: var(--sys-label3)">
							Kalau penawaran ini sudah jadi SO, taut kan di sini supaya tercatat sebagai jejak hulu SO tersebut.
						</p>
						<div class="flex gap-2">
							<input
								type="text"
								placeholder="Nomor SO, mis. PO/EPI/0210426/412"
								class="flex-1 h-9 px-3 rounded-lg border text-[12px]"
								style="border-color: var(--sys-sep)"
								bind:value={soSearchInput}
							/>
							<button
								class="h-9 px-3 rounded-lg text-[12px] font-semibold text-white disabled:opacity-60"
								style="background: var(--sys-accent, #2563eb)"
								disabled={soSearching || !soSearchInput.trim()}
								onclick={handleLinkSo}
							>
								{soSearching ? '...' : 'Tautkan ke SO'}
							</button>
						</div>
						{#if soLinkError}
							<p class="text-[11px] text-red-600 mt-1">{soLinkError}</p>
						{/if}
					{/if}
				</div>
			{/if}
		</div>

		<!-- Items -->
		<div>
			<div class="flex items-center justify-between mb-2">
				<p class="text-[13px] font-semibold" style="color: var(--sys-label)">Item Pekerjaan</p>
				<select
					class="h-9 px-2 rounded-lg border text-[11px] font-semibold"
					style="border-color: var(--sys-sep)"
					onchange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v) addItem(v as ServiceType); (e.target as HTMLSelectElement).value = ''; }}
				>
					<option value="">+ Tambah Item</option>
					{#each SERVICE_TYPES as s (s.id)}
						<option value={s.id}>{s.icon} {s.label}</option>
					{/each}
				</select>
			</div>

			{#if items.length === 0}
				<div class="rounded-xl border border-dashed p-6 text-center text-[12px]" style="border-color: var(--sys-sep); color: var(--sys-label3)">
					Belum ada item. Tambahkan Sandblasting, Painting, atau Floor Coating.
				</div>
			{/if}

			<div class="flex flex-col gap-2.5">
				{#each items as it, i (it.key)}
					{@const e = enriched[i]}
					<div class="rounded-xl border p-3" style="border-color: var(--sys-sep)">
						<button class="w-full flex items-center justify-between gap-2" onclick={() => (openIndex = openIndex === i ? null : i)}>
							<div class="flex items-center gap-2 min-w-0">
								<span class="text-[10px] font-bold px-1.5 py-0.5 rounded" style="background:var(--gl); color:var(--g)">
									{SERVICE_TYPES.find((s) => s.id === it.service_type)?.icon}
								</span>
								<span class="text-[12px] font-semibold truncate" style="color: var(--sys-label)">{it.object_name || 'Objek belum diisi'}</span>
							</div>
							<div class="flex items-center gap-2 shrink-0">
								<span class="text-[11px] font-semibold" style="color: var(--sys-label3)">{fmtRp(e?.subtotal || 0)}</span>
								{#if openIndex === i}<IconChevronUp size={14} />{:else}<IconChevronDown size={14} />{/if}
							</div>
						</button>

						{#if openIndex === i}
							<div class="mt-3 flex flex-col gap-2.5 pt-3 border-t" style="border-color: var(--sys-sep)">
								<input class="w-full h-10 px-3 rounded-lg border text-[13px]" style="border-color: var(--sys-sep)" placeholder="Nama Objek (mis. Tangki A)" bind:value={it.object_name} />
								<div class="grid grid-cols-2 gap-2.5">
									<div>
										<label class="text-[10px] font-semibold mb-1 block" style="color: var(--sys-label3)">Luas (m&sup2;)</label>
										<input type="number" min="0" step="0.1" class="w-full h-10 px-3 rounded-lg border text-[13px]" style="border-color: var(--sys-sep)" bind:value={it.area} />
									</div>
									<div>
										<label class="text-[10px] font-semibold mb-1 block" style="color: var(--sys-label3)">Qty (unit serupa)</label>
										<input type="number" min="1" class="w-full h-10 px-3 rounded-lg border text-[13px]" style="border-color: var(--sys-sep)" bind:value={it.qty} />
									</div>
								</div>

								{#if it.service_type === 'sandblasting'}
									<div class="grid grid-cols-2 gap-2.5">
										<div>
											<label class="text-[10px] font-semibold mb-1 block" style="color: var(--sys-label3)">Standar Persiapan</label>
											<select class="w-full h-10 px-2 rounded-lg border text-[12px]" style="border-color: var(--sys-sep)" bind:value={it.inputs.surfacePrep} onchange={() => applyAbrasiveStandard(it)}>
												<option value="">-</option>
												{#each SURFACE_PREP_STANDARDS as s}<option value={s.id}>{s.label}</option>{/each}
											</select>
										</div>
										<div>
											<label class="text-[10px] font-semibold mb-1 block" style="color: var(--sys-label3)">Kondisi Permukaan</label>
											<select class="w-full h-10 px-2 rounded-lg border text-[12px]" style="border-color: var(--sys-sep)" bind:value={it.inputs.surfaceCondition} onchange={() => applyAbrasiveStandard(it)}>
												<option value="">-</option>
												{#each SURFACE_CONDITIONS as c}<option value={c.id}>{c.label}</option>{/each}
											</select>
										</div>
									</div>
									<div>
										<label class="text-[10px] font-semibold mb-1 block" style="color: var(--sys-label3)">Media Abrasive</label>
										<select class="w-full h-10 px-2 rounded-lg border text-[12px]" style="border-color: var(--sys-sep)"
											onchange={(e) => { const m = materials.find((x) => x.id === (e.target as HTMLSelectElement).value); if (m) { it.inputs.abrasiveName = m.name; it.inputs.abrasivePrice = m.unit_price; if (m.default_consumption) it.inputs.abrasiveConsumption = m.default_consumption; items = [...items]; } }}>
											<option value="">{it.inputs.abrasiveName || '— pilih master —'}</option>
											{#each materials.filter((m) => m.category === 'abrasive') as m}<option value={m.id}>{m.name} — {fmtRp(m.unit_price)}/{m.unit}</option>{/each}
										</select>
									</div>
									<div class="grid grid-cols-2 gap-2.5">
										<div>
											<label class="text-[10px] font-semibold mb-1 block" style="color: var(--sys-label3)">Konsumsi (kg/m&sup2;)</label>
											<input type="number" min="0" step="0.5" class="w-full h-10 px-3 rounded-lg border text-[13px]" style="border-color: var(--sys-sep)" bind:value={it.inputs.abrasiveConsumption} />
										</div>
										<div>
											<label class="text-[10px] font-semibold mb-1 block" style="color: var(--sys-label3)">Harga (Rp/kg)</label>
											<input type="number" min="0" class="w-full h-10 px-3 rounded-lg border text-[13px]" style="border-color: var(--sys-sep)" bind:value={it.inputs.abrasivePrice} />
										</div>
									</div>
									<div class="grid grid-cols-2 gap-2.5">
										<div>
											<label class="text-[10px] font-semibold mb-1 block" style="color: var(--sys-label3)">Produktivitas (m&sup2;/hari)</label>
											<input type="number" min="0" class="w-full h-10 px-3 rounded-lg border text-[13px]" style="border-color: var(--sys-sep)" placeholder="60" bind:value={it.inputs.productivity} />
										</div>
										<div>
											<label class="text-[10px] font-semibold mb-1 block" style="color: var(--sys-label3)">Sewa Kompresor/hari</label>
											<input type="number" min="0" class="w-full h-10 px-3 rounded-lg border text-[13px]" style="border-color: var(--sys-sep)" bind:value={it.inputs.compressorRate} />
										</div>
									</div>
								{:else if it.service_type === 'painting'}
									<div class="flex items-center justify-between">
										<span class="text-[11px] font-semibold" style="color: var(--sys-label3)">Lapisan Cat (Coats)</span>
										<button class="text-[11px] font-bold px-2 py-1 rounded-lg text-white" style="background: var(--p, var(--g))" onclick={() => addCoat(it)}>+ Coat</button>
									</div>
									{#each it.inputs.coats || [] as coat, ci}
										<div class="rounded-lg border p-2.5 flex flex-col gap-2" style="border-color: var(--sys-sep); background: var(--sys-fill2)">
											<div class="flex items-center justify-between">
												<span class="text-[10px] font-bold" style="color: var(--sys-label3)">Coat #{ci + 1}</span>
												<button class="text-[10px] text-red-600" onclick={() => removeCoat(it, ci)}>Hapus</button>
											</div>
											<select class="w-full h-9 px-2 rounded-lg border text-[11px]" style="border-color: var(--sys-sep)"
												onchange={(e) => { const m = materials.find((x) => x.id === (e.target as HTMLSelectElement).value); if (m) { coat.name = m.name; coat.price = m.unit_price; if (m.volume_solids) coat.volumeSolids = m.volume_solids; if (m.default_dft) coat.dft = m.default_dft; items = [...items]; } }}>
												<option value="">{coat.name || '— pilih master —'}</option>
												{#each materials.filter((m) => m.category === 'paint') as m}<option value={m.id}>{m.name} — {fmtRp(m.unit_price)}/{m.unit}</option>{/each}
											</select>
											<div class="grid grid-cols-2 gap-2">
												<div>
													<label class="text-[10px]" style="color: var(--sys-label3)">Volume Solids (%)</label>
													<input type="number" min="1" max="100" class="w-full h-9 px-2 rounded-lg border text-[12px]" style="border-color: var(--sys-sep)" bind:value={coat.volumeSolids} />
												</div>
												<div>
													<label class="text-[10px]" style="color: var(--sys-label3)">DFT (&micro;m)</label>
													<input type="number" min="1" class="w-full h-9 px-2 rounded-lg border text-[12px]" style="border-color: var(--sys-sep)" bind:value={coat.dft} />
												</div>
											</div>
											<div class="grid grid-cols-2 gap-2">
												<div>
													<label class="text-[10px]" style="color: var(--sys-label3)">Metode</label>
													<select class="w-full h-9 px-2 rounded-lg border text-[12px]" style="border-color: var(--sys-sep)" bind:value={coat.method} onchange={() => { coat.loss = lossForMethod(coat.method); items = [...items]; }}>
														{#each APPLICATION_METHODS as m}<option value={m.id}>{m.label}</option>{/each}
													</select>
												</div>
												<div>
													<label class="text-[10px]" style="color: var(--sys-label3)">Harga (Rp/L)</label>
													<input type="number" min="0" class="w-full h-9 px-2 rounded-lg border text-[12px]" style="border-color: var(--sys-sep)" bind:value={coat.price} />
												</div>
											</div>
											<p class="text-[10px]" style="color: var(--sys-label3)">Spreading: {theoreticalSpreadingRate(coat.volumeSolids, coat.dft).toFixed(1)} m&sup2;/L</p>
										</div>
									{/each}
									<div class="grid grid-cols-2 gap-2.5">
										<div>
											<label class="text-[10px] font-semibold mb-1 block" style="color: var(--sys-label3)">Produktivitas (m&sup2;/hari)</label>
											<input type="number" min="0" class="w-full h-10 px-3 rounded-lg border text-[13px]" style="border-color: var(--sys-sep)" placeholder="150" bind:value={it.inputs.productivity} />
										</div>
										<div>
											<label class="text-[10px] font-semibold mb-1 block" style="color: var(--sys-label3)">Sewa Sprayer/hari</label>
											<input type="number" min="0" class="w-full h-10 px-3 rounded-lg border text-[13px]" style="border-color: var(--sys-sep)" bind:value={it.inputs.sprayerRate} />
										</div>
									</div>
								{:else if it.service_type === 'floor_coating'}
									<div>
										<label class="text-[10px] font-semibold mb-1 block" style="color: var(--sys-label3)">Sistem Lantai</label>
										<select class="w-full h-10 px-2 rounded-lg border text-[12px]" style="border-color: var(--sys-sep)" bind:value={it.inputs.system}>
											<option value="">-</option>
											{#each FLOOR_SYSTEMS as s}<option value={s.id}>{s.label}</option>{/each}
										</select>
									</div>
									<div class="flex items-center justify-between">
										<span class="text-[11px] font-semibold" style="color: var(--sys-label3)">Lapisan (Primer/Body/Top)</span>
										<button class="text-[11px] font-bold px-2 py-1 rounded-lg text-white" style="background: var(--p, var(--g))" onclick={() => addLayer(it)}>+ Layer</button>
									</div>
									{#each it.inputs.layers || [] as layer, li}
										<div class="rounded-lg border p-2.5 flex flex-col gap-2" style="border-color: var(--sys-sep); background: var(--sys-fill2)">
											<div class="flex items-center justify-between">
												<span class="text-[10px] font-bold" style="color: var(--sys-label3)">Layer #{li + 1}</span>
												<button class="text-[10px] text-red-600" onclick={() => removeLayer(it, li)}>Hapus</button>
											</div>
											<select class="w-full h-9 px-2 rounded-lg border text-[11px]" style="border-color: var(--sys-sep)"
												onchange={(e) => { const m = materials.find((x) => x.id === (e.target as HTMLSelectElement).value); if (m) { layer.name = m.name; layer.price = m.unit_price; if (m.default_consumption) layer.consumption = m.default_consumption; items = [...items]; } }}>
												<option value="">{layer.name || '— pilih master —'}</option>
												{#each materials.filter((m) => m.category === 'coating') as m}<option value={m.id}>{m.name} — {fmtRp(m.unit_price)}/{m.unit}</option>{/each}
											</select>
											<div class="grid grid-cols-2 gap-2">
												<div>
													<label class="text-[10px]" style="color: var(--sys-label3)">Konsumsi (kg/m&sup2;)</label>
													<input type="number" min="0" step="0.05" class="w-full h-9 px-2 rounded-lg border text-[12px]" style="border-color: var(--sys-sep)" bind:value={layer.consumption} />
												</div>
												<div>
													<label class="text-[10px]" style="color: var(--sys-label3)">Harga (Rp/kg)</label>
													<input type="number" min="0" class="w-full h-9 px-2 rounded-lg border text-[12px]" style="border-color: var(--sys-sep)" bind:value={layer.price} />
												</div>
											</div>
										</div>
									{/each}
									<div class="grid grid-cols-2 gap-2.5">
										<div>
											<label class="text-[10px] font-semibold mb-1 block" style="color: var(--sys-label3)">Produktivitas (m&sup2;/hari)</label>
											<input type="number" min="0" class="w-full h-10 px-3 rounded-lg border text-[13px]" style="border-color: var(--sys-sep)" placeholder="80" bind:value={it.inputs.productivity} />
										</div>
										<div>
											<label class="text-[10px] font-semibold mb-1 block" style="color: var(--sys-label3)">Sewa Alat/hari</label>
											<input type="number" min="0" class="w-full h-10 px-3 rounded-lg border text-[13px]" style="border-color: var(--sys-sep)" bind:value={it.inputs.equipmentRate} />
										</div>
									</div>
									<div>
										<label class="text-[10px] font-semibold mb-1 block" style="color: var(--sys-label3)">Persiapan Permukaan (Rp/m&sup2;)</label>
										<input type="number" min="0" class="w-full h-10 px-3 rounded-lg border text-[13px]" style="border-color: var(--sys-sep)" bind:value={it.inputs.prepRate} />
									</div>
								{/if}

								<div class="grid grid-cols-2 gap-2 text-[11px] pt-2 border-t" style="border-color: var(--sys-sep); color: var(--sys-label3)">
									<span>Material: <b>{fmtRp(e?.material_cost || 0)}</b></span>
									<span>Hari kerja: <b>{e?.meta?.days || 0}</b></span>
								</div>

								<button class="text-[11px] font-semibold text-red-600 flex items-center gap-1 mt-1" onclick={() => removeItem(i)}>
									<IconTrash size={13} /> Hapus Item
								</button>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		</div>

		<!-- Manpower global -->
		<div class="rounded-xl border p-3.5" style="border-color: var(--sys-sep)">
			<div class="flex items-center justify-between mb-2">
				<p class="text-[13px] font-semibold" style="color: var(--sys-label)">Tenaga Kerja</p>
				<button class="text-[11px] font-bold px-2 py-1 rounded-lg text-white flex items-center gap-1" style="background: var(--p, var(--g))" onclick={addManpowerRow}>
					<IconPlus size={12} /> Peran
				</button>
			</div>
			{#if manpower.length === 0}
				<p class="text-[11px] italic" style="color: var(--sys-label3)">Belum ada tenaga kerja.</p>
			{:else}
				<div class="flex flex-col gap-2">
					{#each manpower as m, i}
						<div class="flex items-center gap-1.5">
							<select class="h-9 w-20 px-1 rounded-lg border text-[10px]" style="border-color: var(--sys-sep)" onchange={(e) => pickLaborMaster(i, (e.target as HTMLSelectElement).value)}>
								<option value="">Master</option>
								{#each resources.filter((r) => r.type === 'labor') as r}<option value={r.id}>{r.name}</option>{/each}
							</select>
							<input class="h-9 flex-1 min-w-0 px-2 rounded-lg border text-[12px]" style="border-color: var(--sys-sep)" placeholder="Peran" bind:value={m.role} />
							<input type="number" min="1" class="h-9 w-14 px-1 rounded-lg border text-[12px] text-center" style="border-color: var(--sys-sep)" bind:value={m.count} />
							<input type="number" min="0" class="h-9 w-24 px-2 rounded-lg border text-[12px]" style="border-color: var(--sys-sep)" bind:value={m.dailyWage} />
							<button class="text-red-500 shrink-0" onclick={() => removeManpowerRow(i)}><IconTrash size={14} /></button>
						</div>
					{/each}
				</div>
				<p class="text-[11px] mt-2" style="color: var(--sys-label3)">{globalCrew} orang &middot; {fmtRp(globalDailyLabor)}/hari &middot; {totalDays} hari kerja</p>
			{/if}
		</div>

		<!-- Biaya tambahan & margin -->
		<div class="rounded-xl border p-3.5" style="border-color: var(--sys-sep)">
			<p class="text-[13px] font-semibold mb-2" style="color: var(--sys-label)">Biaya Tambahan & Margin</p>
			<div class="grid grid-cols-2 gap-2.5 mb-2.5">
				<div>
					<label class="text-[10px] font-semibold mb-1 block" style="color: var(--sys-label3)">Mobilisasi (Rp)</label>
					<input type="number" min="0" class="w-full h-10 px-3 rounded-lg border text-[13px]" style="border-color: var(--sys-sep)" bind:value={header.mobilisasi_amount} />
				</div>
				<div>
					<label class="text-[10px] font-semibold mb-1 block" style="color: var(--sys-label3)">Scaffolding (Rp)</label>
					<input type="number" min="0" class="w-full h-10 px-3 rounded-lg border text-[13px]" style="border-color: var(--sys-sep)" bind:value={header.scaffolding_amount} />
				</div>
				<div>
					<label class="text-[10px] font-semibold mb-1 block" style="color: var(--sys-label3)">Safety/APD (Rp)</label>
					<input type="number" min="0" class="w-full h-10 px-3 rounded-lg border text-[13px]" style="border-color: var(--sys-sep)" bind:value={header.safety_amount} />
				</div>
				<div>
					<label class="text-[10px] font-semibold mb-1 block" style="color: var(--sys-label3)">Diskon (Rp)</label>
					<input type="number" min="0" class="w-full h-10 px-3 rounded-lg border text-[13px]" style="border-color: var(--sys-sep)" bind:value={header.discount_amount} />
				</div>
				<div>
					<label class="text-[10px] font-semibold mb-1 block" style="color: var(--sys-label3)">Overhead (%)</label>
					<input type="number" min="0" step="0.5" class="w-full h-10 px-3 rounded-lg border text-[13px]" style="border-color: var(--sys-sep)" bind:value={header.overhead_pct} />
				</div>
				<div>
					<label class="text-[10px] font-semibold mb-1 block" style="color: var(--sys-label3)">
						Margin (%) {#if marginWarning === 'danger'}<span class="text-red-600">⚠</span>{/if}
					</label>
					<input type="number" min="0" step="0.5" class="w-full h-10 px-3 rounded-lg border text-[13px]" style="border-color: {marginWarning === 'danger' ? '#F87171' : 'var(--sys-sep)'}" bind:value={header.margin_pct} />
				</div>
			</div>
			<label class="flex items-center gap-2 text-[12px]" style="color: var(--sys-label)">
				<input type="checkbox" bind:checked={header.ppn_enabled} />
				Kenakan PPN
				<input type="number" min="0" step="0.5" class="w-16 h-8 px-2 rounded-lg border text-[12px]" style="border-color: var(--sys-sep)" bind:value={header.ppn_pct} /> %
			</label>
		</div>

		<!-- Estimasi Jadwal -->
		<div class="rounded-xl border p-3.5" style="border-color: var(--sys-sep)">
			<label class="flex items-center gap-2 text-[13px] font-semibold mb-2" style="color: var(--sys-label)">
				<input type="checkbox" bind:checked={header.schedule_enabled} />
				Estimasi Jadwal Pekerjaan
			</label>
			{#if header.schedule_enabled}
				<div class="grid grid-cols-2 gap-2.5">
					<div>
						<label class="text-[10px] font-semibold mb-1 block" style="color: var(--sys-label3)">Tanggal Mulai</label>
						<input type="date" class="w-full h-10 px-3 rounded-lg border text-[13px]" style="border-color: var(--sys-sep)" bind:value={header.schedule_start_date} />
					</div>
					<div>
						<label class="text-[10px] font-semibold mb-1 block" style="color: var(--sys-label3)">Hari Kerja / Minggu</label>
						<select class="w-full h-10 px-2 rounded-lg border text-[13px]" style="border-color: var(--sys-sep)" bind:value={header.working_days_per_week}>
							<option value={5}>5 hari</option>
							<option value={6}>6 hari</option>
							<option value={7}>7 hari</option>
						</select>
					</div>
					<div>
						<label class="text-[10px] font-semibold mb-1 block" style="color: var(--sys-label3)">Hari Mobilisasi</label>
						<input type="number" min="0" class="w-full h-10 px-3 rounded-lg border text-[13px]" style="border-color: var(--sys-sep)" bind:value={header.mob_days} />
					</div>
					<div>
						<label class="text-[10px] font-semibold mb-1 block" style="color: var(--sys-label3)">Hari Demobilisasi</label>
						<input type="number" min="0" class="w-full h-10 px-3 rounded-lg border text-[13px]" style="border-color: var(--sys-sep)" bind:value={header.demob_days} />
					</div>
				</div>
				<p class="text-[10px] mt-2" style="color: var(--sys-label3)">
					Total hari kerja pekerjaan: {totalDays} hari (dari kalkulasi item) + {(Number(header.mob_days) || 0) + (Number(header.demob_days) || 0)} hari mob/demob.
				</p>
			{/if}
		</div>

		<!-- Catatan & Syarat -->
		<div class="rounded-xl border p-3.5" style="border-color: var(--sys-sep)">
			<p class="text-[13px] font-semibold mb-2" style="color: var(--sys-label)">Catatan & Syarat</p>
			<div class="flex flex-col gap-2.5">
				<div>
					<label class="text-[10px] font-semibold mb-1 block" style="color: var(--sys-label3)">Termin Pembayaran</label>
					<textarea rows="2" class="w-full px-3 py-2 rounded-lg border text-[13px]" style="border-color: var(--sys-sep)" bind:value={header.payment_terms}></textarea>
				</div>
				<div>
					<label class="text-[10px] font-semibold mb-1 block" style="color: var(--sys-label3)">Catatan (Notes)</label>
					<textarea rows="2" class="w-full px-3 py-2 rounded-lg border text-[13px]" style="border-color: var(--sys-sep)" placeholder="Catatan tambahan untuk customer" bind:value={header.notes}></textarea>
				</div>
				<div>
					<label class="text-[10px] font-semibold mb-1 block" style="color: var(--sys-label3)">Syarat & Ketentuan</label>
					<textarea rows="3" class="w-full px-3 py-2 rounded-lg border text-[13px]" style="border-color: var(--sys-sep)" bind:value={header.terms}></textarea>
				</div>
			</div>
		</div>

		<!-- Ringkasan -->
		<div class="rounded-xl border p-3.5 sticky bottom-0 bg-white" style="border-color: var(--sys-sep)">
			<p class="text-[13px] font-semibold mb-2" style="color: var(--sys-label)">Ringkasan</p>
			<div class="flex flex-col gap-1 text-[11px]" style="color: var(--sys-label3)">
				<div class="flex justify-between"><span>Total Luas</span><span>{totals.totalArea.toLocaleString('id-ID')} m&sup2;</span></div>
				<div class="flex justify-between"><span>Biaya Langsung</span><span>{fmtRp(totals.directTotal)}</span></div>
				<div class="flex justify-between"><span>Upah Global</span><span>{fmtRp(globalLaborCost)}</span></div>
				<div class="flex justify-between"><span>Overhead</span><span>{fmtRp(totals.overhead)}</span></div>
				<div class="flex justify-between"><span>Margin</span><span>{fmtRp(totals.margin)}</span></div>
				{#if totals.discount > 0}<div class="flex justify-between text-red-600"><span>Diskon</span><span>-{fmtRp(totals.discount)}</span></div>{/if}
				<div class="flex justify-between"><span>PPN {totals.ppnPct}%</span><span>{fmtRp(totals.ppn)}</span></div>
				<div class="flex justify-between text-[14px] font-bold pt-1 border-t" style="border-color: var(--sys-sep); color: var(--sys-label)">
					<span>Grand Total</span><span>{fmtRp(totals.grandTotal)}</span>
				</div>
			</div>

			{#if marginWarning}
				<p class="text-[11px] mt-2 px-2 py-1.5 rounded-lg" style="background: {marginWarning === 'danger' ? 'var(--rel)' : 'var(--aml)'}; color: {marginWarning === 'danger' ? 'var(--red)' : 'var(--amd)'}">
					⚠ Margin {header.margin_pct}%{marginWarning === 'danger' ? ' — sangat rendah!' : ' — di bawah 10%.'}
				</p>
			{/if}

			{#if floorWarning}
				<p class="text-[11px] mt-2 px-2 py-1.5 rounded-lg" style="background: var(--aml); color: var(--amd)">
					⚠ Grand total {fmtRp(totals.grandTotal)} di bawah estimasi kasar survey {fmtRp(surveyEstimasiMin || 0)} yang sudah disampaikan ke customer. Boleh tetap disimpan — cek ulang dulu kalau tidak disengaja.
				</p>
			{/if}

			{#if errorMsg}
				<p class="text-[12px] mt-2" style="color: #DC2626">{errorMsg}</p>
			{/if}

			<div class="flex gap-2 mt-3">
				<button class="flex-1 h-11 rounded-xl text-[13px] font-bold disabled:opacity-40" style="background: var(--sys-fill); color: var(--sys-label)" disabled={saving} onclick={() => save(false)}>
					{saving ? 'Menyimpan...' : 'Simpan Draft'}
				</button>
				<button class="flex-1 h-11 rounded-xl text-[13px] font-bold text-white disabled:opacity-40" style="background: var(--p, var(--g))" disabled={saving} onclick={() => save(true)}>
					Simpan & Finalkan
				</button>
			</div>
		</div>
	</div>
{/if}
