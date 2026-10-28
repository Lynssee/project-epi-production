<!-- src/lib/components/shared/ApprovalProgressStepper.svelte -->
<!-- F5.1 (Audit & Hardening Gate v2, 30 Agu 2026) — port dari
     erp-epi-1/src/lib/components/shared/ApprovalProgressStepper.svelte, dikonversi ke
     runes (project-epi enforce runes mode). Komponen tampilan murni. Untuk progres
     rantai approval di dashboard lapangan (R7). Sinkronkan manual bila versi admin berubah. -->
<script lang="ts">
    import Tooltip from '$lib/components/ui/Tooltip.svelte';

    let { timeline = null, detail = null, compact = false }: { timeline?: any; detail?: any; compact?: boolean } = $props();

    function formatDate(d: any) {
        if (!d) return '';
        const dt = new Date(d);
        if (isNaN(dt.getTime())) return String(d);
        return dt.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) +
            ' ' + dt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    }

    // Build unified steps from timeline or intelligent fallback
    let computedSteps = $derived(resolveSteps(timeline, detail));
    let progressInfo = $derived(computeProgress(computedSteps, detail, timeline));

    function resolveSteps(tl: any, dt: any): any[] {
        if (tl?.steps && Array.isArray(tl.steps) && tl.steps.length > 0) {
            return tl.steps.map((s: any, idx: number) => {
                const status = (s.status || '').toLowerCase();
                let state = 'waiting'; // 'completed' | 'active' | 'waiting' | 'rejected' | 'skipped'
                if (['disetujui', 'approved', 'done', 'completed'].includes(status)) {
                    state = 'completed';
                } else if (['ditolak', 'rejected'].includes(status)) {
                    state = 'rejected';
                } else if (['dilewati', 'skipped'].includes(status)) {
                    state = 'skipped';
                } else if (status === 'menunggu' || status === 'pending') {
                    const isCurrent = tl.currentStep ? (s.step_order === tl.currentStep) : (idx === 0 || tl.steps[idx - 1]?.status === 'disetujui');
                    state = isCurrent ? 'active' : 'waiting';
                }

                return {
                    id: s.step_order || idx + 1,
                    order: idx + 1,
                    label: s.label || `Tahap ${idx + 1}`,
                    role: s.department_key || '',
                    statusText: s.status === 'disetujui' ? 'Disetujui' : (s.status === 'ditolak' ? 'Ditolak' : (s.status === 'dilewati' ? 'Dilewati' : 'Menunggu')),
                    state,
                    actorName: s.actor_name || null,
                    date: s.date || null,
                    note: s.note || null
                };
            });
        }

        // Fallback Step Builder untuk data legacy atau non-workflow
        if (!dt) return [] as any[];

        const steps: any[] = [];
        const isRejected = dt.status === 'Rejected';
        const isApproved = ['Approved', 'Fully Approved', 'Diproses Finance', 'Diproses', 'Completed', 'Selesai'].includes(dt.status) || Boolean(dt.project_finance_approved || dt.project_finance_approved_by);
        const isDisbursed = ['Completed', 'Selesai'].includes(dt.status) || Boolean(dt.tanggal_dicairkan);
        const isOperasional = ['operasional', 'contingency'].includes(dt.kategori);

        // Rantai persetujuan sebenarnya (Approval Engine) — dipakai saat timeline nyata
        // belum termuat, supaya node "Verifikasi & Persetujuan" tidak keliru menyebut
        // "Project Finance" sebagai approver pertama. Pengajuan Proyek selalu lewat
        // Manajer Proyek dulu; kategori jasa/gaji manpower TIDAK melewati Project Finance.
        const isProyek = Boolean(dt.project_id);
        const reviewRole = !isProyek
            ? 'Finance AP'
            : (dt.kategori === 'jasa'
                ? 'Manajer Proyek → HRD → Finance'
                : 'Manajer Proyek → Project Finance → Finance');
        const reviewFirstPic = isProyek ? 'Manajer Proyek' : 'Finance AP';

        // Step 1: Diajukan
        steps.push({
            id: 1,
            order: 1,
            label: 'Pengajuan Dibuat',
            role: dt.department || 'Pengaju',
            statusText: 'Diajukan',
            state: 'completed',
            actorName: dt.nama_pengaju || 'Pengaju',
            date: dt.date_created,
            note: null
        });

        // Step 2: Review & Approval berjenjang (Manajer Proyek → ... → Finance)
        if (isRejected) {
            steps.push({
                id: 2,
                order: 2,
                label: 'Verifikasi & Persetujuan',
                role: reviewRole,
                statusText: 'Ditolak',
                state: 'rejected',
                actorName: dt.project_finance_approved_by || dt.approved_by || null,
                date: dt.date_updated || dt.tanggal_disetujui || null,
                note: dt.reject_reason || dt.revision_notes || 'Pengajuan ditolak'
            });
        } else if (isApproved) {
            steps.push({
                id: 2,
                order: 2,
                label: 'Verifikasi & Persetujuan',
                role: reviewRole,
                statusText: 'Disetujui',
                state: 'completed',
                actorName: dt.project_finance_approved_by || dt.approved_by || null,
                date: dt.tanggal_disetujui || dt.date_updated || null,
                note: dt.catatan_approval || null
            });
        } else {
            steps.push({
                id: 2,
                order: 2,
                label: 'Verifikasi & Persetujuan',
                role: reviewRole,
                pic: reviewFirstPic,
                statusText: `Menunggu ${reviewFirstPic}`,
                state: 'active',
                actorName: null,
                date: null,
                note: isProyek ? `Persetujuan pertama oleh ${reviewFirstPic}, lalu berlanjut otomatis ke tahap berikutnya.` : null
            });
        }

        // Step 3: Pencairan Dana (Finance AP)
        if (isRejected) {
            steps.push({
                id: 3,
                order: 3,
                label: 'Pencairan Dana (Disbursement)',
                role: 'Finance AP',
                statusText: 'Dibatalkan',
                state: 'skipped',
                actorName: null,
                date: null,
                note: null
            });
        } else if (isDisbursed) {
            steps.push({
                id: 3,
                order: 3,
                label: 'Pencairan Dana (Disbursement)',
                role: 'Finance AP',
                statusText: 'Sudah Dicairkan',
                state: 'completed',
                actorName: dt.finance_processed_by || 'Finance AP',
                date: dt.tanggal_dicairkan || null,
                note: dt.jumlah_disetujui ? `Nominal cair: Rp ${Number(dt.jumlah_disetujui).toLocaleString('id-ID')}` : null
            });
        } else if (isApproved) {
            steps.push({
                id: 3,
                order: 3,
                label: 'Pencairan Dana (Disbursement)',
                role: 'Finance AP',
                statusText: 'Menunggu Pembayaran',
                state: 'active',
                actorName: null,
                date: null,
                note: null
            });
        } else {
            steps.push({
                id: 3,
                order: 3,
                label: 'Pencairan Dana (Disbursement)',
                role: 'Finance AP',
                statusText: 'Belum Diproses',
                state: 'waiting',
                actorName: null,
                date: null,
                note: null
            });
        }

        // Step 4: SPJ (Hanya untuk operasional/contingency)
        if (isOperasional && isDisbursed) {
            const spjStatus = dt.status_pertanggungjawaban;
            const isSpjDone = spjStatus === 'selesai' || spjStatus === 'diverifikasi';
            const isSpjVerif = spjStatus === 'menunggu_verifikasi';

            steps.push({
                id: 4,
                order: 4,
                label: 'Pertanggungjawaban (SPJ)',
                role: 'Pengaju & Finance',
                statusText: isSpjDone ? 'SPJ Diverifikasi' : (isSpjVerif ? 'Menunggu Verifikasi SPJ' : 'Menunggu Bukti Bon/Nota'),
                state: isSpjDone ? 'completed' : 'active',
                actorName: dt.verifikator_spj_email || null,
                date: dt.tanggal_pertanggungjawaban || dt.tanggal_verifikasi_spj || null,
                note: dt.catatan_pertanggungjawaban || null
            });
        }

        return steps;
    }

    function computeProgress(steps: any, dt: any, tl: any) {
        if (!steps || steps.length === 0) return { percent: 0, currentLabel: '-', isDone: false, isRejected: false };
        const total = steps.length;
        const completedCount = steps.filter((s: any) => s.state === "completed").length;
        const activeStep = steps.find((s: any) => s.state === "active");
        const rejectedStep = steps.find((s: any) => s.state === "rejected");

        // Pakai timeline nyata (tl.steps) kalau ada -- itu sumber kebenaran per-tahap.
        // dt.status ("Completed"/"Selesai" krn pencairan dana, mis.) TIDAK BOLEH
        // menimpa fakta ada tahap yang statusnya masih "waiting"/"active" di
        // timeline nyata -- itu menghasilkan header "Selesai Penuh" yang bertolak
        // belakang dengan kartu tahap di bawahnya yang masih "MENUNGGU".
        const usingRealTimeline = !!(tl?.steps && Array.isArray(tl.steps) && tl.steps.length > 0);
        const hasUnfinishedStep = steps.some((s: any) => s.state === 'waiting' || s.state === 'active');

        let percent = Math.round((completedCount / total) * 100);
        if (dt?.status === 'Rejected' || rejectedStep) {
            return {
                percent,
                total,
                completedCount,
                currentLabel: `Ditolak pada tahap ${rejectedStep?.label || 'Approval'}`,
                activeRole: rejectedStep?.role || 'Approver',
                isDone: false,
                isRejected: true,
                rejectReason: rejectedStep?.note || dt?.reject_reason || 'Pengajuan tidak disetujui'
            };
        }

        const isDone = usingRealTimeline
            ? (completedCount === total && !hasUnfinishedStep)
            : (completedCount === total || ['Completed', 'Selesai'].includes(dt?.status));
        if (isDone) {
            return {
                percent: 100,
                total,
                completedCount: total,
                currentLabel: 'Semua Tahap Selesai (Disetujui & Dicairkan)',
                activeRole: null,
                isDone: true,
                isRejected: false
            };
        }

        return {
            percent,
            total,
            completedCount,
            currentLabel: activeStep ? `Sedang Menunggu: ${activeStep.label}` : `Tahap ${completedCount + 1} dari ${total}`,
            activeRole: activeStep?.pic || activeStep?.role || null,
            isDone: false,
            isRejected: false
        };
    }
</script>

<div class="bg-white dark:bg-slate-900/90 rounded-2xl border border-gray-200 dark:border-slate-800 p-4 md:p-5 shadow-xs transition-all">
    <!-- Stepper Header: Title & Dynamic Progress Summary -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-gray-100 dark:border-slate-800/80">
        <div>
            <div class="flex items-center gap-2">
                <span class="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 text-sm">
                    ⚡
                </span>
                <h4 class="font-bold text-gray-900 dark:text-white text-sm md:text-base">
                    Progress & Tahapan Approval
                </h4>
                {#if progressInfo.isDone}
                    <span class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60">
                        ✅ Selesai Penuh
                    </span>
                {:else if progressInfo.isRejected}
                    <span class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-400 border border-red-200 dark:border-red-800/60">
                        ✕ Ditolak
                    </span>
                {:else}
                    <span class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-400 border border-amber-200 dark:border-amber-800/60 animate-pulse">
                        ⏳ Sedang Berjalan
                    </span>
                {/if}
            </div>
            <p class="text-xs text-gray-500 dark:text-slate-400 mt-1 flex items-center gap-1.5 flex-wrap">
                <span>{progressInfo.currentLabel}</span>
                {#if progressInfo.activeRole}
                    <span class="px-1.5 py-0.2 rounded bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 font-medium">
                        PIC: {progressInfo.activeRole}
                    </span>
                {/if}
            </p>
        </div>

        <!-- Mini Progress Bar -->
        <div class="flex items-center gap-2.5 shrink-0">
            <div class="w-32 md:w-40 bg-gray-200 dark:bg-slate-800 rounded-full h-2.5 overflow-hidden">
                <div
                    class="h-2.5 rounded-full transition-all duration-500 {progressInfo.isRejected ? 'bg-red-500' : progressInfo.isDone ? 'bg-emerald-500' : 'bg-gradient-to-r from-blue-500 to-indigo-600'}"
                    style="width: {progressInfo.percent}%"
                ></div>
            </div>
            <span class="text-xs font-bold text-gray-700 dark:text-slate-300 font-mono">
                {progressInfo.percent}%
            </span>
        </div>
    </div>

    <!-- Rejection Alert Banner (if rejected) -->
    {#if progressInfo.isRejected && progressInfo.rejectReason}
        <div class="mb-4 p-3.5 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 rounded-xl text-xs text-red-800 dark:text-red-300 flex items-start gap-2.5">
            <span class="text-base shrink-0">⚠️</span>
            <div>
                <strong class="font-bold block">Pengajuan Ini Ditolak</strong>
                <p class="mt-0.5">{progressInfo.rejectReason}</p>
            </div>
        </div>
    {/if}

    <!-- Visual Stepper Chain -->
    <div class="relative">
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-3.5 relative" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));">
            {#each computedSteps as step, i}
                <div
                    class="relative p-3.5 rounded-xl border transition-all flex flex-col justify-between {
                        step.state === 'completed'
                            ? 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/50 shadow-2xs'
                            : step.state === 'active'
                            ? 'bg-blue-50/80 dark:bg-blue-950/30 border-blue-300 dark:border-blue-700/80 shadow-md ring-2 ring-blue-400/20 dark:ring-blue-500/20'
                            : step.state === 'rejected'
                            ? 'bg-red-50/60 dark:bg-red-950/20 border-red-200 dark:border-red-800/50'
                            : step.state === 'skipped'
                            ? 'bg-gray-50 dark:bg-slate-800/30 border-gray-200 dark:border-slate-800 opacity-60'
                            : 'bg-gray-50/70 dark:bg-slate-800/40 border-gray-200 dark:border-slate-800 text-gray-400'
                    }"
                >
                    <!-- Step Top: Order Badge & State Tag -->
                    <div class="flex items-center justify-between gap-2 mb-2">
                        <div class="flex items-center gap-2">
                            <!-- Node Bubble -->
                            <span
                                class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-transform {
                                    step.state === 'completed'
                                        ? 'bg-emerald-600 text-white shadow-xs'
                                        : step.state === 'active'
                                        ? 'bg-blue-600 text-white shadow-md ring-4 ring-blue-200 dark:ring-blue-900/60 animate-pulse'
                                        : step.state === 'rejected'
                                        ? 'bg-red-600 text-white'
                                        : step.state === 'skipped'
                                        ? 'bg-gray-300 dark:bg-slate-700 text-gray-600 dark:text-slate-400'
                                        : 'bg-gray-200 dark:bg-slate-700 text-gray-500 dark:text-slate-400'
                                }"
                            >
                                {#if step.state === 'completed'}
                                    ✓
                                {:else if step.state === 'rejected'}
                                    ✕
                                {:else if step.state === 'skipped'}
                                    ↷
                                {:else}
                                    {step.order}
                                {/if}
                            </span>
                            <span class="text-[11px] font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                                Tahap {step.order}
                            </span>
                        </div>

                        <!-- Status Label Badge -->
                        <span
                            class="px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider {
                                step.state === 'completed'
                                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300'
                                    : step.state === 'active'
                                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300 font-bold'
                                    : step.state === 'rejected'
                                    ? 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300'
                                    : step.state === 'skipped'
                                    ? 'bg-gray-200 text-gray-600 dark:bg-slate-700 dark:text-slate-400'
                                    : 'bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-500'
                            }"
                        >
                            {step.statusText}
                        </span>
                    </div>

                    <!-- Step Body: Label & Details -->
                    <div class="space-y-1">
                        <h5
                            class="font-bold text-xs leading-snug {
                                step.state === 'completed'
                                    ? 'text-gray-900 dark:text-white'
                                    : step.state === 'active'
                                    ? 'text-blue-900 dark:text-blue-200'
                                    : step.state === 'rejected'
                                    ? 'text-red-900 dark:text-red-200'
                                    : 'text-gray-600 dark:text-slate-400'
                            }"
                        >
                            {step.label}
                        </h5>

                        {#if step.role}
                            <p class="text-[11px] font-medium text-gray-500 dark:text-slate-400">
                                {step.role}
                            </p>
                        {/if}

                        {#if step.actorName}
                            <p class="text-[11px] text-gray-700 dark:text-slate-300 flex items-center gap-1 font-medium mt-1">
                                <span class="text-[10px]">👤</span>
                                <Tooltip text={step.actorName} position="top"><span class="truncate max-w-[12rem]">{step.actorName}</span></Tooltip>
                            </p>
                        {/if}

                        {#if step.date}
                            <p class="text-[10px] text-gray-400 dark:text-slate-500 flex items-center gap-1">
                                <span class="text-[9px]">📅</span>
                                <span>{formatDate(step.date)}</span>
                            </p>
                        {/if}

                        {#if step.note}
                            <div class="mt-2 p-2 rounded bg-white/80 dark:bg-slate-900/80 border border-gray-200 dark:border-slate-800 text-[11px] text-gray-700 dark:text-slate-300 italic">
                                "{step.note}"
                            </div>
                        {/if}
                    </div>
                </div>
            {/each}
        </div>
    </div>
</div>
