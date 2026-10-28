<!-- src/lib/components/anggaran/DynamicBudgetForm.svelte
     Pengajuan Anggaran v3 — Renderer field dinamis (K5) dengan Searchable Combobox,
     Rich Metadata (Customer, Nilai Rp, Status, Tanggal), Selected Entity Preview Card,
     Quick Presets & Live Calculation (Komisi & Progress Termin). -->
<script lang="ts">
	import { readItems } from '@directus/sdk';
	import directus from '$lib/services/directus';
	import type { BudgetCategoryField } from '$lib/services/budgetCategory';
	import { tick } from 'svelte';

	let {
		fields = [],
		values = $bindable({})
	}: {
		fields: BudgetCategoryField[];
		values: Record<string, any>;
	} = $props();

	interface RelationItem {
		value: any;
		primary: string;
		secondary: string;
		poNumber?: string;
		amount: number;
		date?: string;
		status?: string;
		searchStr: string;
		collection: string;
		raw: any;
	}

	let relationOptions = $state<Record<string, RelationItem[]>>({});
	let relationLoading = $state<Record<string, boolean>>({});
	let searchQueries = $state<Record<string, string>>({});
	let openDropdownKey = $state<string | null>(null);
	let highlightedIndices = $state<Record<string, number>>({});
	let inputRefs: Record<string, HTMLInputElement> = {};
	let listRefs: Record<string, HTMLDivElement> = {};

	let employeeNames = $state<string[]>([]);
	let loadedEmployees = false;

	const COLLECTION_ICONS: Record<string, string> = {
		projects: '🏗️',
		master_supplier: '🏢',
		fleet_kendaraan: '🚗',
		karyawan: '👤',
		contract_registry: '📜',
		so_customer: '📄',
		pengajuan: '📋'
	};

	function getCollectionIcon(collection: string) {
		return COLLECTION_ICONS[collection] || '📌';
	}

	function formatCurrency(n: number): string {
		if (!n && n !== 0) return 'Rp 0';
		return new Intl.NumberFormat('id-ID', {
			style: 'currency',
			currency: 'IDR',
			maximumFractionDigits: 0
		}).format(n);
	}

	function getStatusBadgeClass(status?: string): string {
		if (!status) return 'bg-slate-100 text-slate-600';
		const s = String(status).toLowerCase();
		if (s.includes('paid') || s.includes('selesai') || s.includes('completed') || s.includes('active') || s.includes('aktif') || s.includes('approved') || s.includes('delivered')) {
			return 'bg-emerald-50 text-emerald-700 border border-emerald-200';
		}
		if (s.includes('deliver') || s.includes('kirim') || s.includes('invoiced') || s.includes('tagih')) {
			return 'bg-blue-50 text-blue-700 border border-blue-200';
		}
		if (s.includes('pending') || s.includes('proses') || s.includes('draft') || s.includes('expiring')) {
			return 'bg-amber-50 text-amber-700 border border-amber-200';
		}
		if (s.includes('cancel') || s.includes('batal') || s.includes('tolak') || s.includes('reject')) {
			return 'bg-rose-50 text-rose-700 border border-rose-200';
		}
		return 'bg-slate-100 text-slate-700 border border-slate-200';
	}

	let loadedRelationKey = $state('');
	$effect(() => {
		const relFields = (fields || []).filter((f) => f.field_type === 'select_relation');
		const key = relFields.map((f) => `${f.field_key}:${f.field_options?.collection ?? ''}`).join('|');
		if (key === loadedRelationKey) return;
		loadedRelationKey = key;
		if (relFields.length === 0) {
			relationOptions = {};
			return;
		}
		void loadRelationOptions(relFields);
	});

	async function loadRelationOptions(relFields: BudgetCategoryField[]) {
		if (!loadedEmployees) {
			void loadEmployeeSuggestions();
		}

		const next: Record<string, RelationItem[]> = {};
		for (const f of relFields) {
			const collection = f.field_options?.collection;
			if (!collection) continue;

			relationLoading[f.field_key] = true;

			try {
				let fieldsToFetch: string[] = ['id'];
				let filterObj: any = undefined;
				let sortObj: string[] | undefined = undefined;

				if (collection === 'so_customer') {
					fieldsToFetch = ['id', 'nomor_so', 'customer_name', 'kode_customer', 'nomor_po_customer', 'tanggal_so', 'grand_total', 'subtotal', 'status', 'sales_name'];
					sortObj = ['-tanggal_so', '-id'];
				} else if (collection === 'contract_registry') {
					fieldsToFetch = ['id', 'contract_number', 'judul', 'pihak_1', 'pihak_2', 'nilai_kontrak', 'status', 'tanggal_mulai', 'tanggal_berakhir', 'project_id'];
					sortObj = ['-id'];
				} else if (collection === 'projects') {
					fieldsToFetch = ['id', 'name', 'nomor_po', 'customer', 'status', 'lokasi', 'leader'];
					sortObj = ['-id'];
				} else if (collection === 'master_supplier') {
					fieldsToFetch = ['id', 'nama', 'kode_supplier', 'kategori', 'telp', 'alamat', 'nama_pic'];
					sortObj = ['nama'];
				} else if (collection === 'fleet_kendaraan') {
					fieldsToFetch = ['id', 'nomor_polisi', 'merk_tipe', 'jenis_kendaraan', 'driver_default', 'penanggung_jawab', 'status', 'odometer'];
					sortObj = ['nomor_polisi'];
				} else if (collection === 'karyawan') {
					fieldsToFetch = ['id', 'nama_karyawan', 'no_karyawan', 'posisi', 'divisi', 'email'];
					sortObj = ['nama_karyawan'];
				} else if (collection === 'pengajuan') {
					fieldsToFetch = ['id', 'nomor_pengajuan', 'tujuan_pengajuan', 'total_amount', 'status', 'date_created', 'nama_pemohon'];
					filterObj = { status_kanonik: { _nin: ['draft', 'ditolak', 'dibatalkan'] } };
					sortObj = ['-date_created'];
				}

				const rows = (await directus.request(
					readItems(collection as any, {
						limit: 200,
						fields: fieldsToFetch as any,
						sort: sortObj,
						filter: filterObj
					})
				)) as any[];

				next[f.field_key] = (rows || []).map((r) => {
					let primary = '';
					let secondary = '';
					let poNumber = '';
					let amount = 0;
					let date = '';
					const status = r.status || '';

					if (collection === 'so_customer') {
						const soNo = (r.nomor_so || '').trim();
						const poNo = (r.nomor_po_customer || '').trim();
						const custName = (r.customer_name || '').trim();
						const salesName = (r.sales_name || '').trim();

						if (soNo) {
							primary = soNo;
						} else if (poNo) {
							primary = `PO: ${poNo}`;
						} else if (custName) {
							primary = `SO — ${custName}`;
						} else {
							primary = `SO #${r.id}`;
						}

						const secParts = [];
						if (custName && primary !== `SO — ${custName}`) secParts.push(`🏢 ${custName}`);
						if (salesName) secParts.push(`👤 Sales: ${salesName}`);
						secondary = secParts.join(' • ');

						poNumber = poNo && !primary.includes(poNo) ? `PO: ${poNo}` : '';
						amount = Number(r.grand_total || r.subtotal || 0);
						date = r.tanggal_so || '';
					} else if (collection === 'contract_registry') {
						const contractNo = (r.contract_number || '').trim();
						const judul = (r.judul || '').trim();
						const vendor = (r.pihak_2 || r.pihak_1 || '').trim();

						primary = contractNo || judul || `Kontrak #${r.id}`;
						const secParts = [];
						if (vendor) secParts.push(`🏢 ${vendor}`);
						if (judul && judul !== primary) secParts.push(judul);
						secondary = secParts.join(' • ');

						amount = Number(r.nilai_kontrak || 0);
						date = r.tanggal_mulai ? `${r.tanggal_mulai}${r.tanggal_berakhir ? ' s/d ' + r.tanggal_berakhir : ''}` : '';
					} else if (collection === 'projects') {
						primary = r.name || `Proyek #${r.id}`;
						const custName = Array.isArray(r.customer) ? (r.customer[0]?.name || '') : (r.customer || '');
						const secParts = [];
						if (custName) secParts.push(`🏢 ${custName}`);
						if (r.lokasi) secParts.push(`📍 ${r.lokasi}`);
						if (r.leader) secParts.push(`👤 PIC: ${r.leader}`);
						secondary = secParts.join(' • ');
						poNumber = r.nomor_po ? `PO: ${r.nomor_po}` : '';
					} else if (collection === 'master_supplier') {
						primary = r.nama || `Supplier #${r.id}`;
						const secParts = [];
						if (r.kategori) secParts.push(`[${r.kategori}]`);
						if (r.nama_pic) secParts.push(`👤 ${r.nama_pic}`);
						if (r.telp) secParts.push(`📞 ${r.telp}`);
						if (r.alamat) secParts.push(r.alamat);
						secondary = secParts.join(' • ');
					} else if (collection === 'fleet_kendaraan') {
						primary = r.nomor_polisi || `Kendaraan #${r.id}`;
						const secParts = [];
						if (r.merk_tipe || r.jenis_kendaraan) secParts.push(r.merk_tipe || r.jenis_kendaraan);
						if (r.driver_default) secParts.push(`👤 Driver: ${r.driver_default}`);
						if (r.penanggung_jawab) secParts.push(`PJ: ${r.penanggung_jawab}`);
						secondary = secParts.join(' • ');
					} else if (collection === 'karyawan') {
						primary = r.nama_karyawan || `Karyawan #${r.id}`;
						const secParts = [];
						if (r.posisi) secParts.push(r.posisi);
						if (r.divisi) secParts.push(r.divisi);
						if (r.no_karyawan) secParts.push(`No: ${r.no_karyawan}`);
						secondary = secParts.join(' • ');
					} else if (collection === 'pengajuan') {
						primary = r.nomor_pengajuan || `#${r.id} — ${r.tujuan_pengajuan || '(tanpa judul)'}`;
						secondary = r.nama_pemohon ? `Pemohon: ${r.nama_pemohon}` : (r.tujuan_pengajuan || '');
						amount = Number(r.total_amount || 0);
						date = r.date_created ? String(r.date_created).split('T')[0] : '';
					} else {
						primary = r.name || r.nama || r.nomor || r.title || r.judul || `#${r.id}`;
						secondary = r.description || r.keterangan || '';
					}

					const rawAmount = amount > 0 ? String(amount) : '';
					const fmtAmount = amount > 0 ? formatCurrency(amount) : '';
					const searchStr = `${primary} ${secondary} ${poNumber} ${status} ${date} ${fmtAmount} ${rawAmount} ${r.kode_customer || ''} ${r.customer_name || ''} ${r.sales_name || ''} ${r.nomor_po_customer || ''} ${r.pihak_1 || ''} ${r.pihak_2 || ''} ${r.lokasi || ''} ${r.no_karyawan || ''} ${r.driver_default || ''}`.toLowerCase();

					return {
						value: r.id,
						primary,
						secondary,
						poNumber,
						amount,
						date,
						status,
						searchStr,
						collection,
						raw: r
					};
				});
			} catch (e) {
				console.warn('[DynamicBudgetForm] gagal memuat opsi relasi untuk', f.field_key, e);
				next[f.field_key] = [];
			} finally {
				relationLoading[f.field_key] = false;
			}
		}
		relationOptions = next;
	}

	async function loadEmployeeSuggestions() {
		try {
			const rows = (await directus.request(
				readItems('karyawan' as any, {
					limit: 200,
					fields: ['nama_karyawan'],
					sort: ['nama_karyawan']
				})
			)) as any[];
			employeeNames = (rows || []).map((k) => k.nama_karyawan).filter(Boolean);
			loadedEmployees = true;
		} catch (e) {
			console.warn('Gagal memuat saran karyawan:', e);
		}
	}

	function setVal(key: string, v: any) {
		values = { ...values, [key]: v };
	}

	// PRJ-37: default tanggal relatif ('today', 'today-13') pada field date, mis. periode gaji = 2 minggu terakhir.
	// Diisi ke values hanya bila masih kosong (supaya ikut tersimpan); pengaju tinggal mengoreksi.
	function resolveDateDefault(def: unknown): string | null {
		const m = /^today(?:([+-])(\d{1,4}))?$/.exec(String(def ?? '').trim());
		if (!m) return null;
		const d = new Date();
		if (m[1]) d.setDate(d.getDate() + (m[1] === '-' ? -1 : 1) * Number(m[2]));
		const p2 = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
	}
	$effect(() => {
		const seed: Record<string, string> = {};
		for (const f of fields || []) {
			if (f.field_type !== 'date') continue;
			const cur = values?.[f.field_key];
			if (cur !== undefined && cur !== null && cur !== '') continue;
			const v = resolveDateDefault((f as any).default_value);
			if (v) seed[f.field_key] = v;
		}
		if (Object.keys(seed).length) values = { ...seed, ...values };
	});

	function selectRelationItem(fieldKey: string, item: RelationItem) {
		setVal(fieldKey, item.value);
		openDropdownKey = null;
		searchQueries[fieldKey] = '';
		highlightedIndices[fieldKey] = -1;
	}

	async function clearRelationItem(fieldKey: string) {
		setVal(fieldKey, null);
		searchQueries[fieldKey] = '';
		openDropdownKey = fieldKey;
		highlightedIndices[fieldKey] = 0;
		await tick();
		if (inputRefs[fieldKey]) {
			inputRefs[fieldKey].focus();
		}
	}

	function getSelectedOption(fieldKey: string, val: any): RelationItem | null {
		if (!val) return null;
		const opts = relationOptions[fieldKey] || [];
		return opts.find((opt) => String(opt.value) === String(val)) || null;
	}

	function getFilteredOptions(fieldKey: string): RelationItem[] {
		const opts = relationOptions[fieldKey] || [];
		const q = (searchQueries[fieldKey] || '').trim().toLowerCase();
		if (!q) return opts.slice(0, 50);

		const tokens = q.split(/\s+/).filter(Boolean);
		const matched = opts.filter((o) => {
			return tokens.every((token) => o.searchStr.includes(token));
		});

		const firstToken = tokens[0];
		matched.sort((a, b) => {
			const aPrim = (a.primary || '').toLowerCase();
			const bPrim = (b.primary || '').toLowerCase();
			const aStarts = aPrim.startsWith(firstToken) ? 2 : (aPrim.includes(firstToken) ? 1 : 0);
			const bStarts = bPrim.startsWith(firstToken) ? 2 : (bPrim.includes(firstToken) ? 1 : 0);
			if (aStarts !== bStarts) return bStarts - aStarts;
			return 0;
		});

		return matched.slice(0, 50);
	}

	function toggleDropdown(fieldKey: string) {
		if (openDropdownKey === fieldKey) {
			openDropdownKey = null;
			highlightedIndices[fieldKey] = -1;
		} else {
			openDropdownKey = fieldKey;
			highlightedIndices[fieldKey] = 0;
			tick().then(() => {
				if (inputRefs[fieldKey]) inputRefs[fieldKey].focus();
			});
		}
	}

	function handleComboboxKeydown(e: KeyboardEvent, fieldKey: string) {
		const opts = getFilteredOptions(fieldKey);
		if (!openDropdownKey || openDropdownKey !== fieldKey) {
			if (e.key === 'ArrowDown' || e.key === 'Enter') {
				e.preventDefault();
				openDropdownKey = fieldKey;
				highlightedIndices[fieldKey] = 0;
			}
			return;
		}

		const max = opts.length - 1;
		const current = highlightedIndices[fieldKey] ?? -1;

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			highlightedIndices[fieldKey] = current < max ? current + 1 : 0;
			scrollHighlightedItem(fieldKey);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			highlightedIndices[fieldKey] = current > 0 ? current - 1 : max;
			scrollHighlightedItem(fieldKey);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (current >= 0 && current <= max && opts[current]) {
				selectRelationItem(fieldKey, opts[current]);
			}
		} else if (e.key === 'Escape') {
			e.preventDefault();
			openDropdownKey = null;
			highlightedIndices[fieldKey] = -1;
		}
	}

	function scrollHighlightedItem(fieldKey: string) {
		tick().then(() => {
			const listEl = listRefs[fieldKey];
			if (!listEl) return;
			const idx = highlightedIndices[fieldKey];
			const activeEl = listEl.querySelector(`[data-idx="${idx}"]`);
			if (activeEl) {
				activeEl.scrollIntoView({ block: 'nearest' });
			}
		});
	}

	function highlightMatch(text: string, query: string): string {
		if (!text || !query || !query.trim()) return text;
		const q = query.trim();
		const tokens = q.split(/\s+/).filter(Boolean);
		if (tokens.length === 0) return text;
		const regex = new RegExp(`(${tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
		return text.replace(regex, '<mark class="bg-amber-200 text-amber-950 rounded-xs px-0.5 font-bold">$1</mark>');
	}

	function handleWindowClick(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target?.closest?.('.relation-dropdown-container')) {
			openDropdownKey = null;
		}
	}

	let selectedSO = $derived.by(() => {
		for (const f of fields) {
			if (f.field_type === 'select_relation' && f.field_options?.collection === 'so_customer' && values[f.field_key]) {
				return getSelectedOption(f.field_key, values[f.field_key]);
			}
		}
		return null;
	});

	let selectedContract = $derived.by(() => {
		for (const f of fields) {
			if (f.field_type === 'select_relation' && f.field_options?.collection === 'contract_registry' && values[f.field_key]) {
				return getSelectedOption(f.field_key, values[f.field_key]);
			}
		}
		return null;
	});

	let liveCommission = $derived.by(() => {
		if (!selectedSO || !selectedSO.amount || !values.persentase_komisi) return null;
		const pct = parseFloat(values.persentase_komisi);
		if (isNaN(pct) || pct <= 0) return null;
		return (selectedSO.amount * pct) / 100;
	});

	let liveContractClaim = $derived.by(() => {
		if (!selectedContract || !selectedContract.amount || !values.progress_persen) return null;
		const pct = parseFloat(values.progress_persen);
		if (isNaN(pct) || pct <= 0) return null;
		return (selectedContract.amount * pct) / 100;
	});

	const COMMISSION_PRESETS = [2, 2.5, 3, 5, 7.5, 10];
	const PROGRESS_PRESETS = [25, 50, 75, 100];
</script>

<svelte:window onclick={handleWindowClick} />

{#if fields.length > 0}
	<div class="card-section space-y-4">
		<!-- Header Section -->
		<div class="flex items-center justify-between pb-2 border-b border-gray-100">
			<div class="flex items-center gap-2">
				<span class="text-sm">🧩</span>
				<span class="text-xs font-bold uppercase tracking-wider text-[var(--p)]">
					Field Tambahan Kategori Ini
				</span>
			</div>
			<span class="text-[10px] font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
				{fields.length} parameter
			</span>
		</div>

		<!-- Dynamic Fields Grid -->
		<div class="space-y-3.5">
			{#each fields as f (f.id)}
				{@const isRelation = f.field_type === 'select_relation'}
				{@const isPercentField = f.field_key === 'persentase_komisi' || f.field_key === 'progress_persen' || (f.field_label || '').toLowerCase().includes('persen') || (f.field_label || '').includes('%')}
				{@const isReceiverField = f.field_key === 'nama_agen' || f.field_key === 'nama_penerima' || (f.field_label || '').toLowerCase().includes('penerima')}
				{@const selectedItem = isRelation ? getSelectedOption(f.field_key, values[f.field_key]) : null}
				{@const collection = f.field_options?.collection || 'projects'}

				<div class="space-y-1">
					<!-- Label & Hint -->
					<div class="flex items-center justify-between">
						<label class="f-label">{f.field_label}{f.is_required ? ' *' : ''}</label>
						{#if isRelation && selectedItem}
							<span class="text-[10px] font-medium text-emerald-600 flex items-center gap-1">
								✓ Data Terpilih
							</span>
						{/if}
					</div>

					{#if f.hint_text}
						<p class="text-[10px] text-gray-400 -mt-0.5 mb-1 leading-snug">{f.hint_text}</p>
					{/if}

					<!-- RENDERER 1: SELECT RELATION (Searchable Combobox + Preview Card) -->
					{#if f.field_type === 'select_relation'}
						<div class="relation-dropdown-container relative">
							{#if selectedItem}
								<!-- SELECTED ENTITY PREVIEW CARD -->
								<div class="p-2.5 bg-gradient-to-r from-amber-50/90 via-orange-50/50 to-white border border-amber-300/80 rounded-xl shadow-2xs">
									<div class="flex items-start justify-between gap-2.5">
										<div class="flex items-start gap-2 min-w-0">
											<div class="w-8 h-8 rounded-lg bg-white border border-amber-200 flex items-center justify-center text-base shrink-0 shadow-2xs">
												{getCollectionIcon(collection)}
											</div>
											<div class="min-w-0 flex-1">
												<div class="flex items-center gap-1.5 flex-wrap">
													<span class="text-xs font-bold text-gray-900 truncate">
														{selectedItem.primary}
													</span>
													{#if selectedItem.status}
														<span class="text-[9px] font-semibold px-1.5 py-0.2 rounded-full {getStatusBadgeClass(selectedItem.status)}">
															{selectedItem.status}
														</span>
													{/if}
												</div>
												{#if selectedItem.secondary}
													<p class="text-[11px] text-gray-600 mt-0.5 truncate">
														{selectedItem.secondary}
													</p>
												{/if}
												<div class="flex items-center gap-2 mt-0.5 text-[10px] text-gray-500 flex-wrap">
													{#if selectedItem.poNumber}
														<span class="font-medium text-amber-800">{selectedItem.poNumber}</span>
													{/if}
													{#if selectedItem.amount > 0}
														<span class="font-bold text-emerald-700">
															💰 Nilai: {formatCurrency(selectedItem.amount)}
														</span>
													{/if}
													{#if selectedItem.date}
														<span>📅 {selectedItem.date}</span>
													{/if}
												</div>
											</div>
										</div>

										<!-- Change button -->
										<button
											type="button"
											onclick={() => clearRelationItem(f.field_key)}
											class="px-2 py-0.5 text-[11px] font-semibold text-amber-800 hover:text-red-600 hover:bg-red-50 rounded-lg border border-amber-200 transition-all shrink-0 flex items-center gap-1"
											title="Ganti pilihan"
										>
											<span>✕</span>
											<span class="hidden sm:inline">Ganti</span>
										</button>
									</div>
								</div>
							{:else}
								<!-- SEARCHABLE INPUT + DROPDOWN LIST -->
								<div class="relative">
									<div class="relative flex items-center">
										<span class="absolute left-3 text-gray-400 pointer-events-none text-xs">
											{getCollectionIcon(collection)}
										</span>
										<input
											type="text"
											bind:this={inputRefs[f.field_key]}
											value={searchQueries[f.field_key] || ''}
											onfocus={() => {
												openDropdownKey = f.field_key;
												if (highlightedIndices[f.field_key] === undefined || highlightedIndices[f.field_key] < 0) {
													highlightedIndices[f.field_key] = 0;
												}
											}}
											oninput={(e) => {
												searchQueries[f.field_key] = (e.target as HTMLInputElement).value;
												openDropdownKey = f.field_key;
												highlightedIndices[f.field_key] = 0;
											}}
											onkeydown={(e) => handleComboboxKeydown(e, f.field_key)}
											placeholder="Ketik untuk mencari {f.field_label} (nomor, customer, nominal, dll)..."
											class="f-input pl-8 pr-8 text-xs placeholder:text-gray-400"
										/>
										<div class="absolute right-2 flex items-center gap-1">
											{#if relationLoading[f.field_key]}
												<div class="w-3.5 h-3.5 border-2 border-[var(--p)] border-t-transparent rounded-full animate-spin"></div>
											{:else if searchQueries[f.field_key]}
												<button
													type="button"
													onclick={() => {
														searchQueries[f.field_key] = '';
														highlightedIndices[f.field_key] = 0;
														if (inputRefs[f.field_key]) inputRefs[f.field_key].focus();
													}}
													class="p-1 text-gray-400 hover:text-gray-600 text-xs"
													title="Hapus kata kunci"
												>✕</button>
											{:else}
												<button
													type="button"
													onclick={() => toggleDropdown(f.field_key)}
													class="p-1 text-gray-400 hover:text-gray-600 text-[10px]"
												>▼</button>
											{/if}
										</div>
									</div>

									<!-- Floating Dropdown List -->
									{#if openDropdownKey === f.field_key}
										{@const opts = getFilteredOptions(f.field_key)}
										{@const query = searchQueries[f.field_key] || ''}
										{@const currentHighlighted = highlightedIndices[f.field_key] ?? -1}
										<div
											bind:this={listRefs[f.field_key]}
											class="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-64 overflow-y-auto divide-y divide-gray-100 animate-in fade-in slide-in-from-top-1 duration-150"
										>
											<!-- Subheader: Search Stats -->
											<div class="px-2.5 py-1 bg-gray-50 text-[10px] font-medium text-gray-500 flex items-center justify-between border-b border-gray-100 sticky top-0 backdrop-blur-xs z-10">
												<span>
													{#if relationLoading[f.field_key]}
														Memuat data...
													{:else if query.trim()}
														Menemukan <strong>{opts.length}</strong> hasil
													{:else}
														Menampilkan <strong>{opts.length}</strong> data teratas
													{/if}
												</span>
												<span class="text-[9px] text-gray-400">↑ ↓ Enter</span>
											</div>

											{#if relationLoading[f.field_key]}
												<div class="p-3 text-center text-xs text-gray-400">
													<div class="inline-block w-3.5 h-3.5 border-2 border-[var(--p)] border-t-transparent rounded-full animate-spin mr-1.5 align-middle"></div>
													Memuat data...
												</div>
											{:else if opts.length === 0}
												<div class="p-3 text-center space-y-1.5">
													<p class="text-xs font-semibold text-gray-600">
														🔍 Tidak ditemukan data yang cocok dengan "{query}"
													</p>
													<p class="text-[10px] text-gray-400">
														Coba nomor dokumen, nama pihak/customer, atau nomor PO.
													</p>
													{#if query}
														<button
															type="button"
															onclick={() => {
																searchQueries[f.field_key] = '';
																highlightedIndices[f.field_key] = 0;
																if (inputRefs[f.field_key]) inputRefs[f.field_key].focus();
															}}
															class="px-2.5 py-0.5 text-[11px] bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-lg font-semibold transition-colors inline-block"
														>
															Reset Pencarian
														</button>
													{/if}
												</div>
											{:else}
												<div class="p-1 space-y-0.5">
													{#each opts as item, idx (item.value)}
														{@const isHighlighted = currentHighlighted === idx}
														<button
															type="button"
															data-idx={idx}
															onclick={() => selectRelationItem(f.field_key, item)}
															onmouseenter={() => highlightedIndices[f.field_key] = idx}
															class="w-full text-left p-2 rounded-lg transition-all flex items-start justify-between gap-2 group
																{isHighlighted
																	? 'bg-amber-100/90 ring-1 ring-amber-400'
																	: 'hover:bg-amber-50/80'}"
														>
															<div class="min-w-0 flex-1">
																<div class="flex items-center gap-1.5 flex-wrap">
																	<span class="text-xs font-bold text-gray-900 group-hover:text-amber-800">
																		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
																		{@html highlightMatch(item.primary, query)}
																	</span>
																	{#if item.status}
																		<span class="text-[9px] font-semibold px-1.5 py-0.2 rounded-full {getStatusBadgeClass(item.status)}">
																			{item.status}
																		</span>
																	{/if}
																</div>
																{#if item.secondary}
																	<p class="text-[11px] text-gray-500 mt-0.5 truncate">
																		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
																		{@html highlightMatch(item.secondary, query)}
																	</p>
																{/if}
																<div class="flex items-center gap-2 mt-0.5 text-[9.5px] text-gray-400 flex-wrap">
																	{#if item.poNumber}
																		<span class="font-medium text-amber-700">
																			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
																			{@html highlightMatch(item.poNumber, query)}
																		</span>
																	{/if}
																	{#if item.amount > 0}
																		<span class="font-semibold text-emerald-600">
																			💰 {formatCurrency(item.amount)}
																		</span>
																	{/if}
																	{#if item.date}
																		<span>📅 {item.date}</span>
																	{/if}
																</div>
															</div>
															<span class="text-amber-600 text-xs font-bold transition-opacity self-center shrink-0 {isHighlighted ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}">
																Pilih ➔
															</span>
														</button>
													{/each}
												</div>
											{/if}
										</div>
									{/if}
								</div>
							{/if}
						</div>

					<!-- RENDERER 2: NUMBER (WITH PERCENTAGE PRESETS & LIVE CALCULATION) -->
					{:else if f.field_type === 'number'}
						<div>
							<div class="relative">
								<input
									type="number"
									step={isPercentField ? '0.1' : '1'}
									min="0"
									max={isPercentField ? '100' : undefined}
									class="f-input {isPercentField ? 'pr-7 font-semibold' : ''}"
									value={values[f.field_key] ?? f.default_value ?? ''}
									oninput={(e) => setVal(f.field_key, Number((e.target as HTMLInputElement).value) || 0)}
								/>
								{#if isPercentField}
									<span class="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400 pointer-events-none">%</span>
								{/if}
							</div>

							<!-- Quick Presets for Percentage Fields -->
							{#if isPercentField}
								{@const presets = f.field_key === 'progress_persen' ? PROGRESS_PRESETS : COMMISSION_PRESETS}
								<div class="flex items-center gap-1 mt-1 flex-wrap">
									<span class="text-[9.5px] text-gray-400 font-medium">Pilihan Cepat:</span>
									{#each presets as p}
										<button
											type="button"
											onclick={() => setVal(f.field_key, p)}
											class="px-1.5 py-0.5 text-[10px] font-semibold rounded transition-all
												{Number(values[f.field_key]) === p
													? 'bg-amber-600 text-white'
													: 'bg-gray-100 hover:bg-amber-100 text-gray-700 hover:text-amber-800'}"
										>
											{p}%
										</button>
									{/each}
								</div>
							{/if}

							<!-- Live Calculation Banners -->
							{#if f.field_key === 'persentase_komisi' && liveCommission !== null && selectedSO}
								<div class="mt-1.5 p-2 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between gap-2 text-xs">
									<div class="text-emerald-800">
										<span class="font-bold">💡 Estimasi Komisi:</span>
										<span class="font-extrabold ml-1 text-emerald-700">
											{formatCurrency(liveCommission)}
										</span>
									</div>
									<span class="text-[10px] text-emerald-600">
										({values[f.field_key]}% × {formatCurrency(selectedSO.amount)})
									</span>
								</div>
							{/if}

							{#if f.field_key === 'progress_persen' && liveContractClaim !== null && selectedContract}
								<div class="mt-1.5 p-2 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between gap-2 text-xs">
									<div class="text-emerald-800">
										<span class="font-bold">💡 Estimasi Klaim:</span>
										<span class="font-extrabold ml-1 text-emerald-700">
											{formatCurrency(liveContractClaim)}
										</span>
									</div>
									<span class="text-[10px] text-emerald-600">
										({values[f.field_key]}% × {formatCurrency(selectedContract.amount)})
									</span>
								</div>
							{/if}
						</div>

					<!-- RENDERER 3: TEXT (WITH EMPLOYEE SUGGESTIONS FOR RECEIVER) -->
					{:else if f.field_type === 'text'}
						<div>
							<div class="relative">
								<input
									type="text"
									list={isReceiverField ? `emp-list-${f.field_key}` : undefined}
									class="f-input {isReceiverField ? 'pl-8' : ''}"
									value={values[f.field_key] ?? f.default_value ?? ''}
									oninput={(e) => setVal(f.field_key, (e.target as HTMLInputElement).value)}
									placeholder={isReceiverField ? 'Ketik atau pilih nama penerima' : ''}
								/>
								{#if isReceiverField}
									<span class="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">👤</span>
									<datalist id={`emp-list-${f.field_key}`}>
										{#each employeeNames as emp}
											<option value={emp}></option>
										{/each}
									</datalist>
								{/if}
							</div>
						</div>

					<!-- RENDERER 4: CURRENCY -->
					{:else if f.field_type === 'currency'}
						<div class="relative">
							<span class="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400 pointer-events-none">Rp</span>
							<input
								type="number"
								placeholder="0"
								class="f-input pl-8"
								value={values[f.field_key] ?? f.default_value ?? ''}
								oninput={(e) => setVal(f.field_key, Number((e.target as HTMLInputElement).value) || 0)}
							/>
						</div>

					<!-- RENDERER 5: TEXTAREA -->
					{:else if f.field_type === 'textarea'}
						<textarea
							class="f-textarea"
							rows="2"
							value={values[f.field_key] ?? f.default_value ?? ''}
							oninput={(e) => setVal(f.field_key, (e.target as HTMLTextAreaElement).value)}
						></textarea>

					<!-- RENDERER 6: DATE -->
					{:else if f.field_type === 'date'}
						<input
							type="date"
							class="f-input"
							value={values[f.field_key] ?? f.default_value ?? ''}
							oninput={(e) => setVal(f.field_key, (e.target as HTMLInputElement).value)}
						/>

					<!-- RENDERER 7: DATERANGE -->
					{:else if f.field_type === 'daterange'}
						<div class="grid grid-cols-2 gap-2">
							<div>
								<span class="text-[9px] text-gray-400 block mb-0.5">Dari:</span>
								<input
									type="date"
									class="f-input text-xs"
									value={values[f.field_key]?.dari ?? ''}
									oninput={(e) => setVal(f.field_key, { ...(values[f.field_key] || {}), dari: (e.target as HTMLInputElement).value })}
								/>
							</div>
							<div>
								<span class="text-[9px] text-gray-400 block mb-0.5">Sampai:</span>
								<input
									type="date"
									class="f-input text-xs"
									value={values[f.field_key]?.sampai ?? ''}
									oninput={(e) => setVal(f.field_key, { ...(values[f.field_key] || {}), sampai: (e.target as HTMLInputElement).value })}
								/>
							</div>
						</div>

					<!-- RENDERER 8: SELECT STATIC -->
					{:else if f.field_type === 'select_static'}
						<select
							class="f-select"
							value={values[f.field_key] ?? ''}
							onchange={(e) => setVal(f.field_key, (e.target as HTMLSelectElement).value)}
						>
							<option value="">— Pilih {f.field_label} —</option>
							{#each (f.field_options?.choices || []) as choice}
								<!-- choice = string biasa ATAU {value,label} -->
								<option value={choice && typeof choice === 'object' ? choice.value : choice}>{choice && typeof choice === 'object' ? (choice.label ?? choice.value) : choice}</option>
							{/each}
						</select>

					<!-- RENDERER 9: FILE -->
					{:else if f.field_type === 'file'}
						<p class="text-[10px] text-gray-400 italic">Gunakan bagian "Dokumen Bukti" di bawah untuk lampiran file.</p>
					{/if}
				</div>
			{/each}
		</div>
	</div>
{/if}

