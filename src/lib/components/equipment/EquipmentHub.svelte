<script lang="ts">
	// Hub Equipment 360° — satu halaman untuk scan QR kendaraan/alat: identitas, banner masa berlaku, aktivitas per kategori
	// (dropdown), dan log per tab yang dimuat on-demand (hemat kuota HP). Data dari /api/equipment/hub/[id]?section=…
	// Perilaku (tab, profil aktivitas, nominal Rp) diatur Superadmin di erp-epi Fleet → Setelan (eq_hub_*); mode G_EQ_SCAN_HUB_ACCESS.
	import { goto } from '$app/navigation';
	import { IconAlertTriangle, IconChevronDown, IconShieldX, IconLoader2, IconInfoCircle } from '@tabler/icons-svelte';
	import UnitHolderCard from '$lib/components/scanner/UnitHolderCard.svelte';
	import { fetchHubSection, EquipmentVerifyError, type EquipmentVerifyResult } from '$lib/services/equipmentVerify';
	import { getStatusSayaProgram } from '$lib/services/ess/training';

	type TabKey = 'perbaikan' | 'p2h' | 'pembelian' | 'pemakaian' | 'spesifikasi';

	let {
		equipmentId,
		verify = null,
		onOpenSheet = null
	}: { equipmentId: string; verify?: EquipmentVerifyResult | null; onOpenSheet?: (() => void) | null } = $props();

	const TAB_LABEL: Record<TabKey, string> = {
		perbaikan: '🛠️ Perbaikan & PM',
		p2h: '📋 P2H & Checklist',
		pembelian: '🛒 Pembelian',
		pemakaian: '🔄 Pemakaian',
		spesifikasi: '📑 Spesifikasi'
	};
	const TAB_HINT: Record<TabKey, string> = {
		perbaikan: 'Work order, tiket kerusakan, jadwal PM, dan komponen terpasang.',
		p2h: 'Riwayat pemeriksaan harian beserta temuan yang tidak baik.',
		pembelian: 'Kapan unit/sparepart dibeli: tanggal, supplier, qty, nomor PO.',
		pemakaian: 'Siapa yang memakai/meminjam unit ini dan kapan.',
		spesifikasi: 'Merk, tipe, tahun, kepemilikan, dan masa berlaku dokumen.'
	};
	const P2H_LABEL: Record<string, string> = { baik: 'Baik / Siap', dilarang: 'Dilarang Digunakan', perlu_periksa: 'Perlu Diperiksa' };
	const STATUS_LABEL: Record<string, string> = {
		available: 'Tersedia',
		rental_out: 'Disewakan ke Klien',
		rental_in: 'Disewa dari Pihak Ketiga',
		on_project: 'Di Proyek',
		under_repair: 'Dalam Perbaikan',
		broken: 'Rusak / Non-Aktif'
	};

	let summary = $state<any>(null);
	let loading = $state(true);
	let errorMsg = $state('');
	let activeTab = $state<TabKey | null>(null);
	let sections = $state<Record<string, any>>({});
	let sectionLoading = $state<Record<string, boolean>>({});
	let sectionError = $state<Record<string, string>>({});
	let menuOpen = $state(false);
	// Pelatihan terkait unit/model ini (dari profil Inventory 360°). Dimuat setelah ringkasan; gagal → kartu tersembunyi (dicatat di konsol).
	let latih = $state<{ id: number; judul: string; sumber: 'unit' | 'model'; wajib: boolean; status?: string | null }[]>([]);
	async function loadPelatihan() {
		latih = [];
		try {
			const r = await fetchHubSection<{ programs: { id: number; judul: string; sumber: 'unit' | 'model'; wajib: boolean }[] }>(equipmentId, 'pelatihan');
			latih = r.programs || [];
			for (const p of latih) {
				getStatusSayaProgram(p.id).then((s) => { latih = latih.map((x) => (x.id === p.id ? { ...x, status: s } : x)); }).catch((e) => console.warn('[hub] status pelatihan gagal:', e?.message || e));
			}
		} catch (e) {
			console.warn('[hub] pelatihan terkait gagal dimuat:', e instanceof Error ? e.message : e);
		}
	}

	const veh = $derived(verify?.kind === 'vehicle' ? verify : null);
	const denied = $derived(!!veh && veh.verification.decision === 'denied' && (veh.verification.warn || veh.verification.blocked));
	const blocked = $derived(!!veh?.verification.blocked);
	// Saat kendaraan dikunci (mode hard) aksi operasional disembunyikan — Lapor Kerusakan tetap ada (keselamatan), sama seperti bottom-sheet.
	const actions = $derived(((summary?.actions as any[]) || []).filter((a) => !blocked || a.id === 'lapor'));
	const primary = $derived(actions[0] ?? null);
	const others = $derived(actions.slice(1));
	const groupedOthers = $derived.by(() => {
		const g: Record<string, any[]> = {};
		for (const a of others) (g[a.group] ||= []).push(a);
		return Object.entries(g);
	});
	const tabs = $derived(((summary?.tabs as TabKey[]) || []).filter((t) => t in TAB_LABEL));

	function fmtDate(d?: string | null) {
		if (!d) return '-';
		const dt = new Date(d);
		return Number.isNaN(dt.getTime()) ? '-' : dt.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
	}
	const rp = (n: number | null | undefined) => (n == null ? null : `Rp${Number(n).toLocaleString('id-ID')}`);

	async function loadSummary() {
		loading = true;
		errorMsg = '';
		try {
			summary = await fetchHubSection(equipmentId, 'summary');
			loadPelatihan();
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Gagal memuat Hub unit.';
		} finally {
			loading = false;
		}
	}

	const SECTION_OF_TAB: Record<TabKey, string | null> = { perbaikan: 'repair', p2h: 'p2h', pembelian: 'purchase', pemakaian: 'usage', spesifikasi: null };

	async function openTab(tab: TabKey) {
		activeTab = activeTab === tab ? null : tab;
		if (activeTab !== tab) return;
		const section = SECTION_OF_TAB[tab];
		if (!section || sections[section] || sectionLoading[section]) return;
		sectionLoading = { ...sectionLoading, [section]: true };
		sectionError = { ...sectionError, [section]: '' };
		try {
			sections = { ...sections, [section]: await fetchHubSection(equipmentId, section as any) };
		} catch (e) {
			const msg = e instanceof EquipmentVerifyError && e.status === 404 ? 'Bagian ini dinonaktifkan oleh administrator.' : e instanceof Error ? e.message : 'Gagal memuat data.';
			sectionError = { ...sectionError, [section]: msg };
		} finally {
			sectionLoading = { ...sectionLoading, [section]: false };
		}
	}

	function runAction(a: { href: string }) {
		menuOpen = false;
		if (a.href.startsWith('tab:')) {
			const t = a.href.slice(4) as TabKey;
			if (activeTab !== t) openTab(t);
			return;
		}
		goto(a.href);
	}

	$effect(() => {
		equipmentId;
		loadSummary();
	});

	const expiryTone = (level: string) =>
		level === 'expired' ? 'background:#FEE2E2;color:#B91C1C' : level === 'soon' ? 'background:#FEF9C3;color:#854D0E' : 'background:#DCFCE7;color:#166534';
	const expiryText = (x: any) =>
		x.level === 'expired' ? `${x.label} LEWAT ${Math.abs(x.daysLeft)} hari (${fmtDate(x.date)})` : x.level === 'soon' ? `${x.label} ${x.daysLeft} hari lagi (${fmtDate(x.date)})` : `${x.label} s/d ${fmtDate(x.date)}`;
</script>

<div class="text-left">
	{#if loading}
		<div class="flex items-center justify-center gap-2 py-10 text-[12px]" style="color: var(--sys-label3)"><IconLoader2 size={16} class="animate-spin" /> Memuat Hub unit…</div>
	{:else if errorMsg}
		<div class="rounded-xl p-4 text-[12px]" style="background: var(--sys-fill); color: var(--red)" role="alert">
			{errorMsg}
			<button class="block mt-2 font-semibold underline" onclick={loadSummary}>Coba lagi</button>
		</div>
	{:else if summary}
		{@const eq = summary.equipment}
		<!-- Identitas -->
		<div class="rounded-2xl p-4 mb-3" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
			<p class="text-[15px] font-bold" style="color: var(--sys-label)">{eq.name}</p>
			<p class="text-[11px]" style="color: var(--sys-label3)">
				{eq.code}{eq.category_name ? ` · ${eq.category_name}` : ''}{summary.vehicle?.nomor_polisi ? ` · ${summary.vehicle.nomor_polisi}` : ''}
			</p>
			<div class="grid grid-cols-2 gap-2 mt-3">
				<div>
					<p class="text-[10px]" style="color: var(--sys-label4)">Status</p>
					<p class="text-[12px] font-semibold" style="color: var(--sys-label)">{STATUS_LABEL[eq.status_operational] || eq.status_operational || '-'}</p>
				</div>
				<div>
					<p class="text-[10px]" style="color: var(--sys-label4)">{summary.kind === 'vehicle' ? 'Odometer (KM)' : 'Hoursmeter (HM)'}</p>
					<p class="text-[12px] font-semibold" style="color: var(--sys-label)">
						{summary.kind === 'vehicle' ? (eq.last_odometer ?? eq.current_km ?? eq.last_hoursmeter ?? '-') : (eq.last_hoursmeter ?? '-')}
					</p>
				</div>
				<div>
					<p class="text-[10px]" style="color: var(--sys-label4)">WO berjalan</p>
					<p class="text-[12px] font-semibold" style="color: {summary.counts.woAktif ? '#B45309' : 'var(--sys-label)'}">{summary.counts.woAktif}{summary.counts.woAktifPlus ? '+' : ''}</p>
				</div>
				<div>
					<p class="text-[10px]" style="color: var(--sys-label4)">P2H terakhir</p>
					<p class="text-[12px] font-semibold" style="color: var(--sys-label)">
						{summary.lastP2h ? `${fmtDate(summary.lastP2h.date)} · ${P2H_LABEL[summary.lastP2h.status_unit] || summary.lastP2h.status_unit || '-'}` : 'Belum ada'}
					</p>
				</div>
			</div>
			{#if summary.nextPm}
				<p class="text-[11px] mt-2" style="color: var(--sys-label3)">PM terdekat jatuh tempo {fmtDate(summary.nextPm.due_date)}</p>
			{/if}
		</div>

		<!-- Pelatihan terkait unit/model ini -->
		{#if latih.length}
			<div class="rounded-2xl p-3 mb-3" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
				<p class="text-[11px] font-bold mb-1.5" style="color: var(--sys-label3)">🎓 Pelatihan untuk alat ini</p>
				{#each latih as p (p.id)}
					<a href="/ess/pelatihan/{p.id}" class="flex items-center justify-between gap-2 py-1.5 text-[12px] font-semibold" style="color: var(--sys-label)">
						<span class="min-w-0 truncate">{p.judul}{p.wajib ? ' · WAJIB' : ''}</span>
						<span class="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-md" style={p.status === 'Lulus' ? 'background:#D1FAE5;color:#047857' : 'background:rgba(0,0,0,0.06);color:var(--sys-label3)'}>{p.status === 'Lulus' ? 'Lulus' : p.status === 'Remedial' ? 'Ulangi' : p.status ? p.status : 'Pelajari'} →</span>
					</a>
				{/each}
			</div>
		{/if}

		<!-- Peringatan pengemudi (G_FLT_DRIVER_LOCK) + pemegang unit -->
		{#if denied && veh}
			<div class="rounded-2xl p-3 mb-3" style="background: #FEE2E2; border: 1px solid #FCA5A5" role="alert">
				<p class="text-[13px] font-extrabold flex items-center gap-1.5" style="color: #B91C1C"><IconShieldX size={16} /> {veh.verification.blocked ? 'KENDARAAN DIKUNCI' : 'PERHATIAN: BUKAN PENGEMUDI TERDAFTAR'}</p>
				<p class="text-[12px] mt-1" style="color: #7F1D1D">{veh.verification.message}</p>
				{#if onOpenSheet}
					<button class="mt-2 text-[12px] font-semibold underline" style="color: #B91C1C" onclick={onOpenSheet} title="Buka opsi alih pakai darurat dan kartu pemegang unit.">Lihat opsi & alih pakai darurat</button>
				{/if}
			</div>
		{/if}
		{#if verify && ((veh && veh.holder && !denied) || (verify.kind === 'tool' && verify.borrower))}
			<div class="mb-3">
				{#if veh && veh.holder}
					<UnitHolderCard person={veh.holder} title={veh.verification.decision === 'authorized' ? 'Anda pengemudi sah unit ini' : 'Pemegang unit saat ini'} tone={veh.verification.decision === 'authorized' ? 'ok' : 'neutral'} lines={[veh.booking?.tujuan ? `Tujuan: ${veh.booking.tujuan}` : null, veh.booking?.keperluan]} />
				{:else if verify.kind === 'tool' && verify.borrower}
					<UnitHolderCard person={verify.borrower} title="Peminjam resmi unit" tone={verify.verification.decision === 'mismatch' ? 'warn' : verify.verification.matches ? 'ok' : 'neutral'} lines={[verify.loan?.projectName ? `Proyek: ${verify.loan.projectName}` : null, verify.loan?.endDatePlanned ? `Pinjam s/d ${verify.loan.endDatePlanned}` : null, verify.loan?.purpose]} />
				{/if}
			</div>
		{/if}

		<!-- Masa berlaku dokumen kendaraan -->
		{#if summary.expiry?.length && summary.expiry.some((x: any) => x.level !== 'ok' && x.level !== 'unknown')}
			<div class="flex flex-col gap-1.5 mb-3" role="status">
				{#each summary.expiry.filter((x: any) => x.level === 'expired' || x.level === 'soon') as x (x.key)}
					<p class="text-[12px] font-semibold rounded-lg px-3 py-2 flex items-center gap-1.5" style={expiryTone(x.level)}><IconAlertTriangle size={14} /> {expiryText(x)}</p>
				{/each}
			</div>
		{/if}

		<!-- Aktivitas -->
		<p class="text-[11px] mb-1.5 flex items-start gap-1" style="color: var(--sys-label3)">
			<IconInfoCircle size={13} class="shrink-0 mt-0.5" /> Mulai dari tombol hijau (aktivitas yang paling sering), atau pilih aktivitas lain. Riwayat unit ada di tab di bawah.
		</p>
		{#if primary}
			<button class="w-full rounded-xl py-3 text-[14px] font-bold text-white mb-2" style="background: var(--g)" title={primary.hint} onclick={() => runAction(primary)}>
				{primary.label}
			</button>
			<p class="text-[10px] -mt-1 mb-2" style="color: var(--sys-label4)">{primary.hint}</p>
		{/if}
		{#if others.length}
			<div class="relative mb-4">
				<button
					class="w-full rounded-xl py-2.5 text-[13px] font-semibold border flex items-center justify-center gap-1.5"
					style="border-color: var(--g); color: var(--g); background: var(--sys-bg, #fff)"
					aria-expanded={menuOpen}
					onclick={() => (menuOpen = !menuOpen)}
				>
					⚡ Pilih Aktivitas Lainnya <IconChevronDown size={15} />
				</button>
				{#if menuOpen}
					<div class="mt-2 rounded-xl border p-2" style="border-color: var(--sys-sep); background: var(--sys-bg, #fff)" role="menu">
						{#each groupedOthers as [group, list] (group)}
							<p class="text-[10px] font-bold uppercase tracking-wide px-2 pt-1.5 pb-1" style="color: var(--sys-label4)">{group}</p>
							{#each list as a (a.id)}
								<button class="w-full text-left rounded-lg px-2 py-2 hover:bg-black/5" role="menuitem" onclick={() => runAction(a)}>
									<span class="block text-[13px] font-semibold" style="color: var(--sys-label)">{a.label}</span>
									<span class="block text-[10px]" style="color: var(--sys-label3)">{a.hint}</span>
								</button>
							{/each}
						{/each}
					</div>
				{/if}
			</div>
		{/if}

		<!-- Log per tab (lazy) -->
		{#if tabs.length}
			<p class="text-[12px] font-semibold mb-1.5" style="color: var(--sys-label3)">Log Unit</p>
			<div class="flex flex-wrap gap-1.5 mb-2">
				{#each tabs as t (t)}
					<button
						class="px-3 py-1.5 rounded-full text-[12px] font-semibold border"
						style={activeTab === t ? 'background: var(--g); color: #fff; border-color: var(--g)' : 'background: var(--sys-bg, #fff); color: var(--sys-label); border-color: var(--sys-sep)'}
						aria-pressed={activeTab === t}
						title={TAB_HINT[t]}
						onclick={() => openTab(t)}
					>{TAB_LABEL[t]}</button>
				{/each}
			</div>
			{#if activeTab}
				<p class="text-[10px] mb-2" style="color: var(--sys-label4)">{TAB_HINT[activeTab]} Data dimuat saat tab dibuka.</p>
			{/if}
		{/if}

		{#if activeTab}
			{@const sec = SECTION_OF_TAB[activeTab]}
			<div class="rounded-2xl p-3" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
				{#if sec && sectionLoading[sec]}
					<div class="flex items-center justify-center gap-2 py-6 text-[12px]" style="color: var(--sys-label3)"><IconLoader2 size={16} class="animate-spin" /> Memuat…</div>
				{:else if sec && sectionError[sec]}
					<p class="text-[12px]" style="color: var(--red)">{sectionError[sec]}</p>
				{:else if activeTab === 'perbaikan' && sections.repair}
					{@const d = sections.repair}
					<p class="text-[11px] font-bold mb-1" style="color: var(--sys-label3)">Work Order ({d.workOrders.length})</p>
					{#each d.workOrders as w (w.id)}
						<div class="flex justify-between gap-2 py-1.5 border-b text-[12px]" style="border-color: var(--sys-sep)">
							<span style="color: var(--sys-label)">{w.keluhan || '(tanpa keterangan)'}</span>
							<span class="shrink-0 text-[11px]" style="color: {w.tanggal_done ? '#166534' : '#B45309'}">{w.tanggal_done ? `Selesai ${fmtDate(w.tanggal_done)}` : 'Berjalan'}</span>
						</div>
					{:else}<p class="text-[12px]" style="color: var(--sys-label3)">Belum ada work order.</p>{/each}
					{#if d.tickets.length}
						<p class="text-[11px] font-bold mt-3 mb-1" style="color: var(--sys-label3)">Tiket Kerusakan ({d.tickets.length})</p>
						{#each d.tickets as t (t.id)}
							<div class="flex justify-between gap-2 py-1.5 border-b text-[12px]" style="border-color: var(--sys-sep)"><span style="color: var(--sys-label)">{t.masalah || '-'}</span><span class="shrink-0 text-[11px]" style="color: var(--sys-label3)">{t.status || ''} · {fmtDate(t.tanggal_lapor)}</span></div>
						{/each}
					{/if}
					<p class="text-[11px] font-bold mt-3 mb-1" style="color: var(--sys-label3)">Jadwal PM ({d.pm.length})</p>
					{#each d.pm as p (p.id)}
						<div class="flex justify-between gap-2 py-1.5 border-b text-[12px]" style="border-color: var(--sys-sep)"><span style="color: var(--sys-label)">{p.task_name}</span><span class="shrink-0 text-[11px]" style="color: var(--sys-label3)">Tempo {fmtDate(p.due_date)}</span></div>
					{:else}<p class="text-[12px]" style="color: var(--sys-label3)">Belum ada jadwal PM.</p>{/each}
					<p class="text-[11px] font-bold mt-3 mb-1" style="color: var(--sys-label3)">Komponen Terpasang ({d.components.length})</p>
					{#each d.components as c (c.id)}
						<button class="w-full text-left flex justify-between gap-2 py-1.5 border-b text-[12px]" style="border-color: var(--sys-sep)" title="Scan QR komponen untuk mencatat kondisinya" onclick={() => goto(`/scan/${encodeURIComponent(`EPI:COMP:${c.id}`)}`)}>
							<span style="color: var(--sys-label)">{c.nama || 'Komponen'}{c.merek ? ` · ${c.merek}` : ''}</span><span class="shrink-0 text-[11px]" style="color: var(--sys-label3)">{c.kode_unit || c.serial_number || `#${c.id}`}</span>
						</button>
					{:else}<p class="text-[12px]" style="color: var(--sys-label3)">Tidak ada komponen terdata.</p>{/each}
				{:else if activeTab === 'p2h' && sections.p2h}
					{@const d = sections.p2h}
					{#if d.findings.length}
						<p class="text-[11px] font-bold mb-1" style="color: #B91C1C">Temuan pada 5 P2H terakhir</p>
						{#each d.findings as f, i (i)}
							<div class="py-1.5 border-b text-[12px]" style="border-color: var(--sys-sep)"><span class="font-semibold" style="color: var(--sys-label)">{f.item}</span> — <span style="color: #B91C1C">{f.hasil}</span>{#if f.notes}<span class="block text-[11px]" style="color: var(--sys-label3)">{f.notes}</span>{/if}</div>
						{/each}
					{/if}
					<p class="text-[11px] font-bold mt-3 mb-1" style="color: var(--sys-label3)">Riwayat Sesi P2H ({d.sessions.length})</p>
					{#each d.sessions as s (s.id)}
						<div class="flex justify-between gap-2 py-1.5 border-b text-[12px]" style="border-color: var(--sys-sep)"><span style="color: var(--sys-label)">{fmtDate(s.date)}</span><span class="text-[11px] font-semibold" style="color: {s.status_unit === 'baik' ? '#166534' : '#B45309'}">{P2H_LABEL[s.status_unit] || s.status_unit || '-'}</span></div>
					{:else}<p class="text-[12px]" style="color: var(--sys-label3)">Belum ada sesi P2H.</p>{/each}
				{:else if activeTab === 'pembelian' && sections.purchase}
					{@const d = sections.purchase}
					{#if !d.linked}
						<p class="text-[12px]" style="color: var(--sys-label3)">Unit ini belum tertaut ke Master Barang, sehingga riwayat pembelian unit belum tersedia.</p>
					{:else}
						{#each d.purchases as p (p.id)}
							<div class="py-2 border-b text-[12px]" style="border-color: var(--sys-sep)">
								<p class="font-semibold" style="color: var(--sys-label)">{p.itemName || 'Barang'} · {p.quantity} {p.unit || ''}</p>
								<p class="text-[11px]" style="color: var(--sys-label3)">{p.poNumber} · {fmtDate(p.poDate)} · {p.supplier || '-'} · diterima {p.receivedQty}/{p.quantity}</p>
								{#if d.costVisible && p.totalPrice != null}<p class="text-[11px]" style="color: var(--sys-label3)">{rp(p.unitPrice)} / satuan · total {rp(p.totalPrice)}</p>{/if}
							</div>
						{:else}<p class="text-[12px]" style="color: var(--sys-label3)">Belum ada riwayat PO untuk unit ini.</p>{/each}
					{/if}
					<p class="text-[11px] font-bold mt-3 mb-1" style="color: var(--sys-label3)" title="Sparepart yang tercatat dipakai pada unit ini (catatan pemakaian sparepart Maintenance)">Sparepart yang Pernah Dipakai ({d.spareparts?.length ?? 0})</p>
					{#each d.spareparts || [] as sp (sp.id)}
						<div class="py-1.5 border-b text-[12px]" style="border-color: var(--sys-sep)">
							<span class="font-semibold" style="color: var(--sys-label)">{sp.name}{sp.brand ? ` · ${sp.brand}` : ''}</span> × {sp.jumlah}
							<span class="block text-[11px]" style="color: var(--sys-label3)">{sp.code || '-'} · {fmtDate(sp.tanggal)}{d.costVisible && sp.lastPrice != null ? ` · harga terakhir ${rp(sp.lastPrice)}` : ''}</span>
						</div>
					{:else}<p class="text-[12px]" style="color: var(--sys-label3)">Belum ada pemakaian sparepart tercatat.</p>{/each}
					{#if !d.costVisible}<p class="text-[10px] mt-2" style="color: var(--sys-label4)">Nominal harga disembunyikan untuk peran Anda.</p>{/if}
				{:else if activeTab === 'pemakaian' && sections.usage}
					{@const d = sections.usage}
					{#if d.kind === 'vehicle'}
						<p class="text-[11px] font-bold mb-1" style="color: var(--sys-label3)">Booking Armada ({d.bookings.length})</p>
						{#each d.bookings as b (b.id)}
							<div class="py-1.5 border-b text-[12px]" style="border-color: var(--sys-sep)"><span class="font-semibold" style="color: var(--sys-label)">{b.requester_name || '-'}</span> · {b.tujuan || b.keperluan || '-'}<span class="block text-[11px]" style="color: var(--sys-label3)">{b.kode_booking || ''} · {fmtDate(b.tanggal_mulai)} · {b.status || ''}</span></div>
						{:else}<p class="text-[12px]" style="color: var(--sys-label3)">Belum ada booking.</p>{/each}
					{/if}
					<p class="text-[11px] font-bold mt-3 mb-1" style="color: var(--sys-label3)">Peminjaman / Penempatan Proyek ({d.loans.length})</p>
					{#each d.loans as l (l.id)}
						<div class="py-1.5 border-b text-[12px]" style="border-color: var(--sys-sep)"><span class="font-semibold" style="color: var(--sys-label)">{l.pic_name || 'PIC tidak tercatat'}</span> · {l.project_name || 'tanpa proyek'}<span class="block text-[11px]" style="color: var(--sys-label3)">{fmtDate(l.start_date)} → {l.end_date_actual ? fmtDate(l.end_date_actual) : `rencana ${fmtDate(l.end_date_planned)}`}{l.purpose ? ` · ${l.purpose}` : ''}</span></div>
					{:else}<p class="text-[12px]" style="color: var(--sys-label3)">Belum ada riwayat peminjaman.</p>{/each}
				{:else if activeTab === 'spesifikasi'}
					<dl class="grid grid-cols-2 gap-x-3 gap-y-2 text-[12px]">
						{#each [['Merk', eq.brand], ['Tipe', eq.model_type], ['Tahun', eq.vehicle_year], ['Warna', eq.color], ['Kepemilikan', eq.ownership_type], ['Pemilik', eq.owner_name], ['Tgl beli', eq.purchase_date ? fmtDate(eq.purchase_date) : null], ['Kategori', eq.category_name]] as [k, v] (k)}
							{#if v}<div><dt class="text-[10px]" style="color: var(--sys-label4)">{k}</dt><dd class="font-semibold" style="color: var(--sys-label)">{v}</dd></div>{/if}
						{/each}
						{#each summary.expiry as x (x.key)}
							<div><dt class="text-[10px]" style="color: var(--sys-label4)">{x.label}</dt><dd class="font-semibold" style="color: var(--sys-label)">{fmtDate(x.date)}</dd></div>
						{/each}
					</dl>
				{/if}
			</div>
		{/if}
	{/if}
</div>
