<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import {
		IconArrowLeft, IconInfoCircle, IconListNumbers, IconPlus,
		IconNote, IconPaperclip, IconSend, IconLoader2, IconCheck
	} from '@tabler/icons-svelte';
	import { onMount } from 'svelte';
	import { getProjectsForCurrentUser } from '$lib/services/projectScope';
	import { getPengajuanById, getPengajuanItems, updatePengajuanAnggaran } from '$lib/services/finance';
	import { getKaryawanByEmail } from '$lib/services/karyawan';
	import { authStore } from '$lib/stores/auth';
	import ProjectSelect from '$lib/components/anggaran/ProjectSelect.svelte';
	import RekeningSelect from '$lib/components/anggaran/RekeningSelect.svelte';

	const itemCategories = [
		{ value: 'operasional', label: 'Biaya Operasional' },
		{ value: 'supplier', label: 'Supplier / Material' },
		{ value: 'consumable', label: 'Consumables' },
		{ value: 'jasa', label: 'Jasa / Subkon' },
		{ value: 'safety', label: 'Safety' },
		{ value: 'sewa_alat', label: 'Sewa Alat Internal' },
		{ value: 'lain_lain', label: 'Biaya Lain-Lain' }
	];

	let id = $derived($page.params.id);
	let budget = $state<any>(null);
	let projects = $state<any[]>([]);
	let selectedProject = $state('');
	let tujuanPengajuan = $state('');
	let kategori = $state('operasional');
	let urgency = $state('Normal');
	let tanggalDibutuhkan = $state('');
	let notes = $state('');
	let submitting = $state(false);
	let loading = $state(true);
	let showSuccessModal = $state(false);

	let paymentMethod = $state('Transfer');
	let penerimaDanaType = $state('');
	let penerimaDanaNama = $state('');
	let bankName = $state('');
	let bankAccountNumber = $state('');
	let bankAccountName = $state('');
	// Penajaman Penerima Dana & Track Record v2, Fase 4 (11 Sep)
	let rekeningPenerimaId = $state<number | null>(null);
	let isTagihanRekening = $state(false);

	let items = $state<any[]>([{ name: '', kategori_item: 'lain_lain', qty: 1, unit: 'Pcs', price: 0, vendorName: '', notes: '' }]);
	let totalAmount = $derived(items.reduce((acc, curr) => acc + (curr.qty * curr.price), 0));

	let currentRoleId = $state<string | null>(null);
	let currentKaryawanName = $state<string | null>(null);
	let currentKaryawanId = $state<number | null>(null);
	let currentKaryawanEmail = $state<string | null>(null);
	let currentKaryawanDivisi = $state<string | null>(null);
	let currentUser = $state<any>(null);
	let currentDirectusToken = $state<string | null>(null);

	let hasLoaded = false;
	const unsubAuth = authStore.subscribe((s) => {
		currentRoleId = s.roleId;
		currentKaryawanName = s.karyawanName;
		currentKaryawanId = s.karyawanId;
		currentDirectusToken = s.directusToken;
		currentUser = s.user;

		if (s.checked && !hasLoaded) {
			hasLoaded = true;
			loadData();
		}
	});

	// Reset item categories when main category changes
	$effect(() => {
		const currentKat = kategori;
		items.forEach(it => {
			it.kategori_item = 'lain_lain';
		});
	});

	async function loadData() {
		try {
			if (currentUser?.email) {
				const kary = await getKaryawanByEmail(currentUser.email);
				if (kary) {
					currentKaryawanDivisi = kary.divisi;
					currentKaryawanEmail = kary.email_company;
					currentKaryawanName = kary.nama_karyawan;
				}
			}

			let projResult: any[];
			projResult = await getProjectsForCurrentUser(false);
			projects = projResult || [];

			// Fetch existing budget data
			budget = await getPengajuanById(id as string);
			if (budget) {
				tujuanPengajuan = budget.tujuan_pengajuan || '';
				kategori = budget.kategori || 'operasional';
				urgency = budget.urgency || 'Normal';
				if (urgency === 'Very Urgent') urgency = 'Sangat Urgent'; // Translate back
				tanggalDibutuhkan = budget.tanggal_dibutuhkan ? budget.tanggal_dibutuhkan.split('T')[0] : new Date(Date.now() - (new Date()).getTimezoneOffset() * 60000).toISOString().split('T')[0];
				notes = budget.comments || '';
				paymentMethod = budget.payment_method || 'Transfer';
				// Translate payment method to start with uppercase if it was saved lowercase
				if (paymentMethod === 'transfer') paymentMethod = 'Transfer';
				if (paymentMethod === 'cash') paymentMethod = 'Cash';

				selectedProject = budget.project_id ? String(budget.project_id) : '';
				penerimaDanaType = budget.penerima_dana_type || '';
				penerimaDanaNama = budget.penerima_dana_nama || '';
				bankName = budget.bank_name || '';
				bankAccountNumber = budget.bank_account_number || '';
				bankAccountName = budget.bank_account_name || '';
				rekeningPenerimaId = budget.rekening_penerima_id || null;

				// Fetch budget items
				const itemsResult = await getPengajuanItems(id as string);
				if (itemsResult && itemsResult.length > 0) {
					items = itemsResult.map((it: any) => ({
						name: it.deskripsi || '',
						kategori_item: it.kategori_item || 'lain_lain',
						qty: it.quantity || 1,
						unit: it.units || 'Pcs',
						price: it.harga || 0,
						vendorName: it.vendor_name || '',
						notes: it.notes || ''
					}));
				} else {
					items = [{ name: '', kategori_item: 'lain_lain', qty: 1, unit: 'Pcs', price: 0, vendorName: '', notes: '' }];
				}
			} else {
				alert('Pengajuan tidak ditemukan.');
				goto('/anggaran');
			}
		} catch (e) {
			console.error('Gagal memuat data edit:', e);
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		return () => unsubAuth();
	});

	function formatCurrency(val: number) {
		return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val);
	}

	function addItem() {
		items = [...items, { name: '', kategori_item: 'lain_lain', qty: 1, unit: 'Pcs', price: 0, vendorName: '', notes: '' }];
	}

	function removeItem(i: number) {
		if (items.length > 1) {
			items = items.filter((_, idx) => idx !== i);
		}
	}

	async function handleSubmit() {
		if (!tujuanPengajuan.trim()) {
			alert('Judul pengajuan harus diisi.');
			return;
		}
		if (!penerimaDanaNama.trim()) {
			alert('Nama penerima dana harus diisi.');
			return;
		}
		if (paymentMethod === 'Transfer') {
			if (!bankName.trim() || !bankAccountNumber.trim() || !bankAccountName.trim()) {
				alert('Informasi rekening bank harus diisi lengkap.');
				return;
			}
		}

		const validItems = items.filter(it => it.name.trim());
		if (validItems.length === 0) {
			alert('Minimal 1 rincian item harus diisi.');
			return;
		}

		// Validasi: nama item tidak boleh hanya berupa nominal/angka
		const numericNameItems = validItems.filter(it => /^[\d.,\s]+$/.test(it.name.trim()) || /^Rp\.?\s*[\d.,]+$/i.test(it.name.trim()));
		if (numericNameItems.length > 0) {
			alert(`Nama item "${numericNameItems[0].name}" tidak boleh hanya berupa angka atau nominal. Masukkan nama atau deskripsi barang/jasa.`);
			return;
		}

		// Validasi: harga item harus lebih dari 0
		const zeroPriceItems = validItems.filter(it => !it.price || Number(it.price) <= 0);
		if (zeroPriceItems.length > 0) {
			alert(`Harga satuan untuk item "${zeroPriceItems[0].name}" harus lebih dari 0.`);
			return;
		}

		try {
			submitting = true;

			const mappedItems = validItems.map(it => {
				return {
					deskripsi: it.name,
					kategori_item: it.kategori_item,
					vendor_name: it.vendorName || '',
					quantity: it.qty,
					units: it.unit,
					harga: it.price,
					notes: it.notes || ''
				};
			});

			const formData = {
				nama_pengaju: budget.nama_pengaju || currentKaryawanName || currentUser?.displayName || 'Leader',
				department: budget.department || currentKaryawanDivisi || 'Project',
				kategori: kategori,
				urgency: urgency === 'Sangat Urgent' ? 'Very Urgent' : urgency,
				tujuan_pengajuan: tujuanPengajuan,
				tanggal_dibutuhkan: tanggalDibutuhkan,
				payment_method: paymentMethod,
				total_amount: totalAmount,
				comments: notes,
				project_id: selectedProject ? Number(selectedProject) : null,
				penerima_dana_type: penerimaDanaType || null,
				penerima_dana_nama: penerimaDanaNama,
				bank_name: paymentMethod === 'Transfer' ? bankName : '',
				bank_account_number: paymentMethod === 'Transfer' ? bankAccountNumber : '',
				bank_account_name: paymentMethod === 'Transfer' ? bankAccountName : '',
				// Penajaman Penerima Dana & Track Record v2, Fase 4
				rekening_penerima_id: paymentMethod === 'Transfer' && !isTagihanRekening ? rekeningPenerimaId : null,
				created_by_email: budget.created_by_email || currentKaryawanEmail || currentUser?.email || null
			};

			const success = await updatePengajuanAnggaran(id as string, formData, mappedItems);
			if (success) {
				showSuccessModal = true;
			} else {
				alert('Gagal memperbarui pengajuan.');
			}
		} catch (e) {
			console.error(e);
			alert('Gagal memperbarui pengajuan.');
		} finally {
			submitting = false;
		}
	}
</script>

<div class="flex-1 flex flex-col h-full">
	{#if loading}
		<CircularProgressGauge size={50} strokeWidth={4} label="Memuat pengajuan untuk diedit..." />
	{:else}
		<div class="scroll-body px-4 py-4 max-w-4xl mx-auto w-full">
			<div class="mb-4">
				<button
					type="button"
					onclick={() => goto(`/anggaran/${id}`)}
					class="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 transition-colors mb-2"
				>
					<IconArrowLeft size={16} />
					<span>Kembali ke Detail Pengajuan</span>
				</button>
				<h2 class="text-lg font-bold text-slate-900 dark:text-slate-100">Edit Pengajuan Anggaran</h2>
			</div>
			<!-- Informasi -->
			<div class="card-section">
				<h4><IconInfoCircle size={16} class="text-[var(--p)]" /> Informasi pengajuan</h4>
				
				<div class="grid grid-cols-2 gap-2 mb-2.5">
					<div>
						<div class="flex items-center gap-1.5 mb-1">
							<label class="f-label mb-0">Nama Pengaju *</label>
							<span class="text-[9px] bg-blue-50 text-blue-500 px-1 py-0.5 rounded font-semibold lowercase">dari akun</span>
						</div>
						<input type="text" class="f-input bg-gray-50 border-gray-200 text-gray-400" value={budget.nama_pengaju || currentKaryawanName || currentUser?.displayName || 'Leader'} disabled>
					</div>
					<div>
						<div class="flex items-center gap-1.5 mb-1">
							<label class="f-label mb-0">Departemen *</label>
							<span class="text-[9px] bg-blue-50 text-blue-500 px-1 py-0.5 rounded font-semibold lowercase">dari akun</span>
						</div>
						<input type="text" class="f-input bg-gray-50 border-gray-200 text-gray-400" value={budget.department || currentKaryawanDivisi || 'Project'} disabled>
					</div>
				</div>

				<div class="grid grid-cols-2 gap-2 mb-2.5">
					<div>
						<label class="f-label">Kategori</label>
						<select bind:value={kategori} class="f-select">
							<option value="operasional">Operasional</option>
							<option value="jasa">Jasa / Pembayaran Proyek</option>
						</select>
					</div>
					<div>
						<label class="f-label">Urgensi</label>
						<select bind:value={urgency} class="f-select">
							<option value="Normal">Normal</option>
							<option value="Urgent">Urgent</option>
							<option value="Sangat Urgent">Sangat Urgent</option>
						</select>
					</div>
				</div>

				<div class="mb-2.5">
					<label class="f-label">Tujuan Pengajuan *</label>
					<input type="text" bind:value={tujuanPengajuan} placeholder="Contoh: Biaya operasional kendaraan bulan April" class="f-input">
				</div>

				<div class="grid grid-cols-2 gap-2 mb-2.5">
					<div>
						<label class="f-label">Tanggal Dibutuhkan *</label>
						<input type="date" bind:value={tanggalDibutuhkan} class="f-input">
					</div>
					<div>
						<label class="f-label">Metode Pembayaran</label>
						<select bind:value={paymentMethod} class="f-select">
							<option value="Transfer">Transfer</option>
							<option value="Cash">Cash</option>
						</select>
					</div>
				</div>

				<div>
					<label class="f-label">Proyek Terkait (opsional)</label>
					<ProjectSelect {projects} bind:value={selectedProject} />
				</div>
			</div>

			<!-- Penerima Dana -->
			<div class="card-section">
				<h4><IconNote size={16} class="text-[var(--p)]" /> Penerima Dana</h4>
				
				<div class="grid grid-cols-2 gap-2 mb-2.5">
					<div>
						<label class="f-label">Tipe Penerima Dana</label>
						<select bind:value={penerimaDanaType} class="f-select">
							<option value="">— Pilih Tipe —</option>
							<option value="pt">PT (Perusahaan)</option>
							<option value="individu">Individu</option>
							<option value="vendor">Vendor</option>
							<option value="pihak_ketiga">Pihak Ketiga</option>
						</select>
					</div>
					<div>
						<label class="f-label">Nama Penerima Dana</label>
						<input type="text" bind:value={penerimaDanaNama} placeholder="Nama PT / Individu / Vendor" class="f-input">
					</div>
				</div>

				{#if paymentMethod === 'Transfer'}
					<div class="border border-gray-100 rounded-xl p-3 bg-gray-50 mt-1">
						<p class="text-[10px] text-gray-400 mb-1">💡 Cari dari "Rekening Terakhir Saya" untuk 1 tap, atau daftarkan rekening baru (wajib diverifikasi Finance dulu).</p>
						<RekeningSelect
							bind:bankName
							bind:bankAccountNumber
							bind:bankAccountName
							bind:rekeningPenerimaId
							bind:isTagihan={isTagihanRekening}
						/>
					</div>
				{/if}
			</div>

			<!-- Daftar Pos Anggaran -->
			<div class="card-section">
				<div class="flex justify-between items-center mb-3">
					<h4 class="mb-0"><IconListNumbers size={16} class="text-[var(--p)]" /> Daftar Pos Anggaran *</h4>
					<span class="text-[12px] font-semibold text-[var(--p)]">Total: {formatCurrency(totalAmount)}</span>
				</div>
				
				{#each items as item, i}
					<div class="border-b border-gray-100 pb-3 mb-3 last:border-none last:pb-0 last:mb-0 relative">
						{#if items.length > 1}
							<button class="absolute top-0 right-0 text-gray-300 hover:text-red-400 text-[11px]" onclick={() => removeItem(i)}>✕</button>
						{/if}
						<div class="mb-2">
							<label class="f-label">Deskripsi</label>
							<input type="text" bind:value={item.name} class="f-input" placeholder="Deskripsi pos anggaran">
						</div>
						
						<div class="grid grid-cols-2 gap-2 mb-2">
							<div>
								<label class="f-label">Kategori</label>
								<select bind:value={item.kategori_item} class="f-select">
									{#each itemCategories as cat}
										<option value={cat.value}>{cat.label}</option>
									{/each}
								</select>
							</div>
							<div>
								<label class="f-label">Vendor (opsional)</label>
								<input type="text" bind:value={item.vendorName} class="f-input" placeholder="Nama vendor">
							</div>
						</div>

						<div class="grid grid-cols-3 gap-2 mb-2">
							<div>
								<label class="f-label">Qty</label>
								<input type="number" bind:value={item.qty} class="f-input" min="1">
							</div>
							<div>
								<label class="f-label">Satuan</label>
								<select bind:value={item.unit} class="f-select">
									<option value="Pcs">Pcs</option>
									<option value="Liter">Liter</option>
									<option value="Sak">Sak</option>
									<option value="Kg">Kg</option>
									<option value="Unit">Unit</option>
									<option value="Set">Set</option>
									<option value="Hari">Hari</option>
									<option value="Jam">Jam</option>
									<option value="Box">Box</option>
									<option value="Lainnya">Lainnya</option>
								</select>
							</div>
							<div>
								<label class="f-label">Est. Harga</label>
								<input type="number" bind:value={item.price} class="f-input">
							</div>
						</div>

						<div class="bg-gray-50 rounded-lg p-2 flex justify-between items-center border border-gray-100">
							<span class="text-[11px] text-gray-400">Subtotal</span>
							<span class="text-[12px] font-semibold text-[var(--pd)]">{formatCurrency(item.qty * item.price)}</span>
						</div>
					</div>
				{/each}

				<button class="btn-action purple" onclick={addItem}>
					<IconPlus size={14} /> + Tambah Pos Anggaran
				</button>
			</div>

			<!-- Catatan Tambahan -->
			<div class="card-section">
				<h4><IconNote size={16} class="text-[var(--p)]" /> Catatan Tambahan</h4>
				<div class="mb-2.5">
					<textarea bind:value={notes} rows="3" placeholder="Tambahkan catatan atau keterangan pengajuan..." class="f-textarea"></textarea>
				</div>
				<div class="border border-dashed border-gray-300 rounded-xl p-4 text-center cursor-pointer hover:bg-gray-50 transition-colors">
					<IconPaperclip size={22} class="text-gray-300 mx-auto" />
					<p class="text-[12px] text-gray-400 mt-1.5">Unggah Dokumen (Opsional, bisa lebih dari 1)</p>
					<p class="text-[11px] text-gray-300 mt-0.5">JPG, PNG, PDF — maks 5MB</p>
				</div>
			</div>
		</div>

		<div class="bottom-bar shadow-[0_-2px_10px_rgba(0,0,0,0.04)]">
			<div class="flex gap-2">
				<button class="py-2.5 px-4 border border-gray-200 rounded-xl text-gray-500 text-[13px] font-medium flex items-center gap-1.5 cursor-pointer active:bg-gray-50 transition-all" onclick={() => goto(`/anggaran/${id}`)}>
					Batal
				</button>
				<button
					class="flex-1 py-2.5 bg-[var(--p)] text-white border-none rounded-xl text-[13px] font-medium flex items-center justify-center gap-1.5 cursor-pointer active:bg-[var(--pd)] transition-all disabled:opacity-60"
					onclick={handleSubmit}
					disabled={submitting}
				>
					{#if submitting}
						<IconLoader2 size={16} class="animate-spin" /> Menyimpan...
					{:else}
						<IconSend size={16} /> Simpan Perubahan
					{/if}
				</button>
			</div>
		</div>
	{/if}
</div>

<!-- Success Popup Modal -->
{#if showSuccessModal}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
		<div class="bg-white rounded-2xl w-full max-w-xs shadow-xl flex flex-col overflow-hidden max-h-[85vh] animate-in fade-in zoom-in-95 duration-200">
			<div class="p-6 text-center">
				<div class="w-14 h-14 rounded-full bg-green-50 flex items-center justify-center text-green-500 mx-auto mb-4 border border-green-100">
					<IconCheck size={28} />
				</div>
				
				<h3 class="text-[15px] font-bold text-gray-800 mb-2 leading-tight">Pengajuan telah diperbarui</h3>
				<p class="text-[11px] text-gray-400 mb-5 px-1 leading-relaxed">
					Perubahan pada pengajuan anggaran Anda berhasil disimpan
				</p>

				<!-- Nomor Pengajuan Box -->
				<div class="bg-gray-50 rounded-xl p-3 border border-gray-100 mb-5">
					<span class="text-[9px] text-gray-400 block mb-0.5 font-semibold uppercase tracking-wider">Nomor Pengajuan</span>
					<strong class="text-[16px] font-mono text-gray-800 tracking-wide">{budget?.nomor_pengajuan}</strong>
				</div>

				<button
					class="w-full py-2.5 px-4 bg-[var(--p)] hover:bg-[var(--pd)] text-white border-none rounded-xl text-[12px] font-semibold transition-colors cursor-pointer active:scale-[0.98]"
					onclick={() => {
						showSuccessModal = false;
						goto('/anggaran');
					}}
				>
					Selesai
				</button>
			</div>
		</div>
	</div>
{/if}
