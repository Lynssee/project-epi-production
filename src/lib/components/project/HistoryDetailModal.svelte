<!-- HistoryDetailModal.svelte — Menampilkan detail isi laporan harian dari history -->
<script lang="ts">
	import { IconX, IconCalendarTime, IconChartLine, IconPackage, IconUsers, IconAlertCircle, IconListCheck, IconTool, IconReceipt, IconCamera, IconClipboardList, IconSun, IconPencil } from '@tabler/icons-svelte';

	interface Props {
		report: any;
		onClose: () => void;
		onEdit?: () => void;
	}

	let { report, onClose, onEdit }: Props = $props();

	import { secureAssetSrc, secureAssetHref } from '$lib/actions/secureAsset';

	function parseField<T>(val: any, fallback: T): T {
		if (!val) return fallback;
		if (typeof val === 'string') {
			try { return JSON.parse(val); } catch { return fallback; }
		}
		return val as T;
	}

	function formatDate(d: string) {
		return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(d));
	}

	function formatCurrency(n: number) {
		return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n || 0);
	}

	const statusLabel: Record<string, string> = {
		draft: 'Draft',
		submitted: 'Terkirim',
		approved: 'Disetujui',
		rejected: 'Ditolak'
	};

	const statusClass: Record<string, string> = {
		draft: 'bg-amber-100 text-amber-700',
		submitted: 'bg-blue-100 text-blue-700',
		approved: 'bg-green-100 text-green-700',
		rejected: 'bg-red-100 text-red-700'
	};

	const itemCategoryLabels: Record<string, string> = {
		operasional: 'Biaya Operasional',
		supplier: 'Supplier / Material',
		consumable: 'Consumables',
		jasa: 'Jasa / Subkon',
		safety: 'Safety',
		sewa_alat: 'Sewa Alat Internal',
		lain_lain: 'Biaya Lain-Lain'
	};

	let schedule = $derived(parseField<any[]>(report.schedule, []));
	let progress = $derived(parseField<any[]>(report.progress, []));
	let materialUsed = $derived(parseField<any[]>(report.material_used, []));
	let materialNeeds = $derived(parseField<any[]>(report.material_needs, []));
	let manpower = $derived(parseField<any[]>(report.manpower, []));
	let tools = $derived(parseField<any[]>(report.tools, []));
	let issues = $derived(parseField<any[]>(report.issues, []));
	let tomorrowPlan = $derived(parseField<any[]>(report.tomorrow_plan, []));
	let budgetItems = $derived(parseField<any[]>(report.budget_items, []));
	let attendancePhotos = $derived(parseField<string[]>(report.attendance_photos, []));
	let progressPhotos = $derived(parseField<string[]>(report.progress_photos, []));
	let issuePhotos = $derived(parseField<string[]>(report.issue_photos, []));
	let weekendPhotos = $derived(parseField<string[]>(report.weekend_photos, []));

	let totalBudget = $derived(budgetItems.reduce((sum: number, b: any) => sum + (Number(b.amount) || 0), 0));

	let hasSchedule = $derived(schedule.some((s: any) => s.activity));
	let hasProgress = $derived(progress.some((p: any) => p.activity || p.category));
	let hasMaterialUsed = $derived(materialUsed.some((m: any) => m.type));
	let hasMaterialNeeds = $derived(materialNeeds.some((m: any) => m.type || m.description));
	let hasManpower = $derived(manpower.some((m: any) => m.role));
	let hasTools = $derived(tools.some((t: any) => t.name));
	let hasIssues = $derived(issues.some((i: any) => i.description) || report.issues_general);
	let hasTomorrowPlan = $derived(tomorrowPlan.some((t: any) => t.activity || t.description) || report.tomorrow_plan_summary);
	let hasBudget = $derived(budgetItems.length > 0 || report.budget_notes);

	function scheduleStatusLabel(s: string) {
		if (s === 'complete' || s === 'done') return '✓ Selesai';
		if (s === 'on-progress' || s === 'in_progress') return '⚡ Proses';
		return '⏳ Pending';
	}
	function scheduleStatusClass(s: string) {
		if (s === 'complete' || s === 'done') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300';
		if (s === 'on-progress' || s === 'in_progress') return 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300';
		return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300';
	}

	function getAllWorkersList(manpower: any[]) {
		if (!manpower || !Array.isArray(manpower)) return '-';
		const workers: string[] = [];
		manpower.forEach(m => {
			if (m.workers && Array.isArray(m.workers)) {
				m.workers.forEach((w: any) => {
					const name = typeof w === 'object' ? w?.nama : w;
					if (name && typeof name === 'string' && !workers.includes(name)) {
						workers.push(name);
					}
				});
			}
		});
		return workers.length > 0 ? workers.join(', ') : '-';
	}

	function formatMaterialTotal(materials: any[]) {
		if (!materials || !Array.isArray(materials)) return '-';
		const cleanList = materials.filter(m => m.type && m.amount);
		if (cleanList.length === 0) return '-';
		
		const totalsByUnit: Record<string, number> = {};
		cleanList.forEach(m => {
			const unit = (m.unit || 'pcs').toLowerCase().trim();
			const amount = Number(m.amount) || 0;
			totalsByUnit[unit] = (totalsByUnit[unit] || 0) + amount;
		});
		
		return Object.entries(totalsByUnit)
			.map(([unit, amount]) => `${amount} ${unit}`)
			.join(', ');
	}
</script>

<div class="modal-overlay" onclick={onClose} role="dialog" aria-modal="true">
	<div class="modal-content" onclick={(e) => e.stopPropagation()}>
		<!-- Drag handle -->
		<div class="drag-handle-wrap">
			<div class="drag-handle"></div>
		</div>
		<!-- Header -->
		<div class="modal-header">
			<div class="flex flex-col gap-0.5">
				<div class="flex items-center gap-2">
					<span class="text-[15px] font-semibold text-gray-800">
						{formatDate(report.date || report.date_created)}
					</span>
					<span class="text-[10px] px-2 py-0.5 rounded font-semibold {statusClass[report.status] || statusClass.draft}">
						{statusLabel[report.status] || 'Draft'}
					</span>
				</div>
				<p class="text-[11px] text-gray-500">Oleh: {report.prepared_by || '-'}</p>
			</div>
			<div class="flex items-center gap-2">
				{#if onEdit}
					<button class="px-3 py-1.5 text-[12px] font-semibold bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors flex items-center gap-1.5" onclick={onEdit}>
						<IconPencil size={14} /> Edit Laporan
					</button>
				{/if}
				<button class="close-btn" onclick={onClose} aria-label="Tutup">
					<IconX size={18} />
				</button>
			</div>
		</div>

		<!-- Body -->
		<div class="modal-body">

			<!-- Info Umum -->
			<div class="section">
				<div class="section-title">
					<IconSun size={14} />
					<span>Info Umum</span>
				</div>
				<div class="info-grid">
					{#if report.weather}
						<div class="info-item">
							<span class="info-label">Cuaca</span>
							<span class="info-value">{report.weather}</span>
						</div>
					{/if}
					{#if report.manpower_count}
						<div class="info-item">
							<span class="info-label">Jumlah Tenaga Kerja</span>
							<span class="info-value">{report.manpower_count} orang</span>
						</div>
					{/if}
					{#if report.project_type}
						<div class="info-item">
							<span class="info-label">Tipe Proyek</span>
							<span class="info-value">{report.project_type}</span>
						</div>
					{/if}
					{#if hasManpower}
						<div class="info-item flex-col items-start gap-1">
							<span class="info-label">Daftar Pekerja</span>
							<span class="info-value text-xs text-gray-600 bg-gray-50/50 px-2.5 py-1.5 rounded-lg border border-gray-100 w-full mt-0.5 whitespace-normal break-words leading-relaxed text-left">
								{getAllWorkersList(manpower)}
							</span>
						</div>
					{/if}
					{#if hasMaterialUsed}
						<div class="info-item flex-col items-start gap-1">
							<span class="info-label">Total Material Terpakai</span>
							<span class="info-value text-xs text-gray-700 bg-gray-50/50 px-2.5 py-1.5 rounded-lg border border-gray-100 w-full mt-0.5 whitespace-normal break-words leading-relaxed text-left">
								{formatMaterialTotal(materialUsed)}
							</span>
						</div>
					{/if}
				</div>
			</div>

			<!-- Jadwal / Schedule -->
			{#if hasSchedule}
				<div class="section">
					<div class="section-title flex items-center justify-between">
						<div class="flex items-center gap-1.5">
							<IconCalendarTime size={15} class="text-[var(--g)]" />
							<span>Jadwal Kegiatan Harian</span>
						</div>
						<span class="text-[11px] font-semibold text-slate-500">
							{schedule.filter(s => s.activity).length} kegiatan
						</span>
					</div>
					<div class="py-2 relative pl-3 before:absolute before:top-3 before:bottom-3 before:left-[15px] before:w-[2px] before:bg-slate-200 dark:before:bg-slate-700 space-y-3">
						{#each schedule as item}
							{#if item.activity}
								<div class="relative flex items-start gap-3">
									<div class="relative z-10 w-2.5 h-2.5 rounded-full mt-1 shrink-0 ring-4 ring-white dark:ring-slate-900
										{item.status === 'complete' || item.status === 'done' ? 'bg-emerald-500' :
										 item.status === 'on-progress' || item.status === 'in_progress' ? 'bg-blue-500' : 'bg-amber-500'}">
									</div>
									<div class="flex-1 bg-slate-50/80 dark:bg-slate-800/60 p-2.5 rounded-xl border border-slate-200/80 dark:border-slate-700/80">
										<div class="flex items-center justify-between gap-2 flex-wrap">
											<span class="text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600">
												{item.start_time || '--:--'} – {item.end_time || '--:--'}
											</span>
											<span class="text-[10px] px-2 py-0.5 rounded font-semibold {scheduleStatusClass(item.status)}">
												{scheduleStatusLabel(item.status)}
											</span>
										</div>
										<p class="text-xs font-semibold text-slate-800 dark:text-slate-100 mt-1">
											{item.activity}
										</p>
									</div>
								</div>
							{/if}
						{/each}
					</div>
				</div>
			{/if}

			<!-- Progress -->
			{#if hasProgress}
				<div class="section">
					<div class="section-title">
						<IconChartLine size={14} />
						<span>Progress Pekerjaan</span>
					</div>
					<div class="divide-y divide-gray-100">
						{#each progress as item}
							{#if item.activity || item.category}
								<div class="py-2.5">
									<div class="flex justify-between items-center gap-2">
										<p class="text-[13px] font-medium text-gray-800 flex-1">{item.activity || item.category}</p>
										<span class="text-[12px] font-semibold text-[var(--g)] shrink-0">
											{item.progress_value || 0} {item.unit || ''}
										</span>
									</div>
									{#if item.notes}
										<p class="text-[11px] text-gray-500 mt-0.5">{item.notes}</p>
									{/if}
								</div>
							{/if}
						{/each}
					</div>
				</div>
			{/if}

			<!-- Foto Progress -->
			{#if progressPhotos.length > 0}
				<div class="section">
					<div class="section-title">
						<IconCamera size={14} />
						<span>Foto Progress</span>
					</div>
					<div class="photo-grid">
						{#each progressPhotos as id}
							<a use:secureAssetHref={id} target="_blank" rel="noopener" class="photo-thumb">
								<img use:secureAssetSrc={id} alt="Foto progress" />
							</a>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Material Terpakai -->
			{#if hasMaterialUsed}
				<div class="section">
					<div class="section-title">
						<IconPackage size={14} />
						<span>Material Terpakai</span>
					</div>
					<div class="divide-y divide-gray-100">
						{#each materialUsed as item}
							{#if item.type}
								<div class="py-2 flex justify-between items-center gap-2">
									<p class="text-[13px] text-gray-800">{item.type}</p>
									<p class="text-[12px] font-semibold text-gray-700 shrink-0">{item.amount} {item.unit || ''}</p>
								</div>
							{/if}
						{/each}
					</div>
				</div>
			{/if}

			<!-- Kebutuhan Material -->
			{#if hasMaterialNeeds}
				<div class="section">
					<div class="section-title">
						<IconAlertCircle size={14} />
						<span>Kebutuhan Material</span>
					</div>
					<div class="divide-y divide-gray-100">
						{#each materialNeeds as item}
							{#if item.type || item.description}
								<div class="py-2.5">
									<div class="flex items-center justify-between gap-2">
										<p class="text-[13px] font-medium text-gray-800 flex-1">{item.description || item.type || '-'}</p>
										<span class="text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0 {item.urgency === 'urgent' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}">
											{item.urgency === 'urgent' ? 'Urgent' : 'Normal'}
										</span>
									</div>
									<p class="text-[12px] text-gray-600">{item.amount} {item.unit || ''}</p>
									{#if item.date_needed}
										<p class="text-[11px] text-gray-400">Butuh: {item.date_needed}</p>
									{/if}
								</div>
							{/if}
						{/each}
					</div>
				</div>
			{/if}

			<!-- Tenaga Kerja -->
			{#if hasManpower}
				<div class="section">
					<div class="section-title">
						<IconUsers size={14} />
						<span>Tenaga Kerja</span>
					</div>
					<div class="divide-y divide-gray-100">
						{#each manpower as item}
							{#if item.role}
								<div class="py-2.5">
									<div class="flex justify-between items-center gap-2">
										<p class="text-[13px] font-medium text-gray-800">{item.role}</p>
										<p class="text-[12px] font-semibold text-gray-700">{item.count || 0} orang</p>
									</div>
									{#if item.workers && item.workers.length > 0}
										<p class="text-[11px] text-gray-500 mt-0.5">
											{item.workers.map((w: any) => typeof w === 'object' ? (w?.nama || w?.name || JSON.stringify(w)) : w).join(', ')}
										</p>
									{/if}
									{#if item.notes}
										<p class="text-[11px] text-gray-400 mt-0.5">{item.notes}</p>
									{/if}
								</div>
							{/if}
						{/each}
					</div>
				</div>
			{/if}

			<!-- Foto Absensi -->
			{#if attendancePhotos.length > 0}
				<div class="section">
					<div class="section-title">
						<IconCamera size={14} />
						<span>Foto Absensi</span>
					</div>
					<div class="photo-grid">
						{#each attendancePhotos as id}
							<a use:secureAssetHref={id} target="_blank" rel="noopener" class="photo-thumb">
								<img use:secureAssetSrc={id} alt="Foto absensi" />
							</a>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Peralatan -->
			{#if hasTools}
				<div class="section">
					<div class="section-title">
						<IconTool size={14} />
						<span>Peralatan & Kondisi P2H</span>
					</div>
					<div class="divide-y divide-gray-100">
						{#each tools as item}
							{#if item.name}
								<div class="py-2.5 space-y-1.5">
									<div class="flex justify-between items-start gap-2">
										<div>
											<p class="text-[13px] font-semibold text-gray-800 m-0">{item.name}</p>
											{#if item.category}
												<span class="text-[10px] text-gray-500 font-medium">{item.category}</span>
											{/if}
										</div>
										<div class="flex items-center gap-1.5 shrink-0">
											{#if item.p2h_result}
												<span class="text-[10px] font-bold px-2 py-0.5 rounded-full {item.p2h_result === 'Go' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}">
													{item.p2h_result === 'Go' ? '🟢 Go' : '🔴 No-Go'}
												</span>
											{:else}
												<span class="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
													Belum P2H
												</span>
											{/if}
											<span class="text-[12px] font-medium text-gray-600">{item.amount || 1} unit</span>
										</div>
									</div>
									<div class="flex items-center gap-3 text-[11px] text-gray-500 flex-wrap">
										{#if item.status_unit}
											<span>Kondisi: <strong class="text-gray-700">{item.status_unit === 'baik' ? 'Baik / Siap Pakai' : item.status_unit === 'perlu_periksa' ? 'Perlu Diperiksa' : item.status_unit === 'dilarang' ? 'Dilarang' : item.status_unit}</strong></span>
										{/if}
										{#if item.hoursmeter != null}
											<span>HM: <strong class="text-gray-700">{item.hoursmeter} HM</strong></span>
										{/if}
										{#if item.operator}
											<span>Operator: <strong class="text-gray-700">{item.operator}</strong></span>
										{/if}
									</div>
									{#if item.keterangan}
										<p class="text-[11px] text-gray-600 italic bg-gray-50 p-1.5 rounded m-0">Catatan: {item.keterangan}</p>
									{/if}
								</div>
							{/if}
						{/each}
					</div>
				</div>
			{/if}

			<!-- Kendala -->
			{#if hasIssues}
				<div class="section">
					<div class="section-title">
						<IconAlertCircle size={14} />
						<span>Kendala</span>
					</div>
					{#if report.issues_general}
						<p class="text-[13px] text-gray-700 mb-2">{report.issues_general}</p>
					{/if}
					{#if issues.some((i: any) => i.description)}
						<div class="divide-y divide-gray-100">
							{#each issues as item}
								{#if item.description}
									<div class="py-2">
										<p class="text-[13px] text-gray-700">{item.description}</p>
									</div>
								{/if}
							{/each}
						</div>
					{/if}
				</div>
			{/if}

			<!-- Foto Kendala -->
			{#if issuePhotos.length > 0}
				<div class="section">
					<div class="section-title">
						<IconCamera size={14} />
						<span>Foto Kendala</span>
					</div>
					<div class="photo-grid">
						{#each issuePhotos as id}
							<a use:secureAssetHref={id} target="_blank" rel="noopener" class="photo-thumb">
								<img use:secureAssetSrc={id} alt="Foto kendala" />
							</a>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Rekapan Mingguan (Jumat) -->
			{#if report.weekend_location_recap || weekendPhotos.length > 0}
				<div class="section">
					<div class="section-title">
						<IconCalendarTime size={14} />
						<span>Rekapan Mingguan Lokasi Absensi</span>
					</div>
					{#if report.weekend_location_recap}
						<p class="text-[13px] text-gray-700 mb-2">{report.weekend_location_recap}</p>
					{/if}
					{#if weekendPhotos.length > 0}
						<div class="photo-grid">
							{#each weekendPhotos as id}
								<a use:secureAssetHref={id} target="_blank" rel="noopener" class="photo-thumb">
									<img use:secureAssetSrc={id} alt="Foto rekapan mingguan" />
								</a>
							{/each}
						</div>
					{/if}
				</div>
			{/if}

			<!-- Rencana Besok -->
			{#if hasTomorrowPlan}
				<div class="section">
					<div class="section-title">
						<IconListCheck size={14} />
						<span>Rencana Besok</span>
					</div>
					{#if report.tomorrow_plan_summary}
						<p class="text-[13px] text-gray-700 mb-2">{report.tomorrow_plan_summary}</p>
					{/if}
					{#if tomorrowPlan.some((t: any) => t.activity || t.description)}
						<div class="divide-y divide-gray-100">
							{#each tomorrowPlan as item}
								{#if item.activity || item.description}
									<div class="py-2">
										<p class="text-[13px] text-gray-700">{item.description || item.activity}</p>
										{#if item.notes}
											<p class="text-[11px] text-gray-400 mt-0.5">{item.notes}</p>
										{/if}
									</div>
								{/if}
							{/each}
						</div>
					{/if}
				</div>
			{/if}

			<!-- Catatan Umum -->
			{#if report.general_notes}
				<div class="section">
					<div class="section-title">
						<IconClipboardList size={14} />
						<span>Catatan Umum</span>
					</div>
					<p class="text-[13px] text-gray-700">{report.general_notes}</p>
				</div>
			{/if}

			<!-- Budget / Pengeluaran -->
			{#if hasBudget}
				<div class="section">
					<div class="section-title">
						<IconReceipt size={14} />
						<span>Pengeluaran Lapangan</span>
					</div>
					{#if budgetItems.length > 0}
						<div class="divide-y divide-gray-100 mb-2">
							{#each budgetItems as item}
								<div class="py-2.5">
									<div class="flex justify-between items-start gap-2">
										<div class="flex-1">
											<p class="text-[13px] font-medium text-gray-800">{item.description || item.name || '-'}</p>
											{#if item.category}
												<p class="text-[11px] text-gray-400">{itemCategoryLabels[item.category] || item.category}</p>
											{/if}
										</div>
										<p class="text-[12px] font-semibold text-gray-700 shrink-0">{formatCurrency(item.amount)}</p>
									</div>
								</div>
							{/each}
						</div>
						<div class="total-row">
							<span class="text-[12px] font-semibold text-gray-600">Total</span>
							<span class="text-[13px] font-bold text-gray-800">{formatCurrency(totalBudget)}</span>
						</div>
					{/if}
					{#if report.budget_notes}
						<p class="text-[12px] text-gray-500 mt-2 italic">{report.budget_notes}</p>
					{/if}
					{#if report.budget_receipt}
						<div class="mt-3">
							<p class="text-[11px] text-gray-400 mb-1.5">Struk / Bukti Pembayaran</p>
							<a use:secureAssetHref={report.budget_receipt} target="_blank" rel="noopener" class="photo-thumb block w-28">
								<img use:secureAssetSrc={report.budget_receipt} alt="Struk pembayaran" class="w-full rounded-lg border border-gray-200" />
							</a>
						</div>
					{/if}
				</div>
			{/if}

		</div>
	</div>
</div>

<style>
	.modal-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: flex-end;
		justify-content: center;
		z-index: 1000;
		padding: 0;
	}

	.modal-content {
		background: var(--sys-bg2);
		border-radius: 16px 16px 0 0;
		width: 100%;
		max-width: 640px;
		height: 88vh;
		display: flex;
		flex-direction: column;
		box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.12);
		overflow: hidden;
	}

	.modal-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		padding: 16px 20px 12px;
		border-bottom: 1px solid var(--sys-sep);
		flex-shrink: 0;
	}

	.close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: 6px;
		border: none;
		background: transparent;
		color: var(--sys-label4);
		cursor: pointer;
		transition: all 0.15s;
		flex-shrink: 0;
		margin-top: 2px;
	}

	.close-btn:hover {
		background: var(--sys-fill);
		color: var(--sys-label2);
	}

	.modal-body {
		overflow-y: auto;
		flex: 1;
		min-height: 0;
		padding-bottom: 40px;
		-webkit-overflow-scrolling: touch;
	}

	.drag-handle-wrap {
		display: flex;
		justify-content: center;
		padding: 10px 0 6px;
		flex-shrink: 0;
	}

	.drag-handle {
		width: 36px;
		height: 4px;
		background: var(--sys-fill3);
		border-radius: 2px;
	}

	.section {
		padding: 14px 20px;
		border-bottom: 1px solid var(--sys-sep);
	}

	.section:last-child {
		border-bottom: none;
	}

	.section-title {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--g, #10b981);
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin-bottom: 10px;
	}

	.info-grid {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.info-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
	}

	.info-label {
		font-size: 12px;
		color: var(--sys-label3);
	}

	.info-value {
		font-size: 13px;
		font-weight: 500;
		color: var(--sys-label2);
	}

	.photo-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 6px;
	}

	.photo-thumb {
		aspect-ratio: 1;
		border-radius: 8px;
		overflow: hidden;
		border: 1px solid var(--sys-sep);
		background: var(--sys-fill);
		display: block;
	}

	.photo-thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.total-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 8px 12px;
		background: var(--sys-fill);
		border-radius: 8px;
	}
</style>
