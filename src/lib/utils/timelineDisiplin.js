// src/lib/utils/timelineDisiplin.js
// Evaluator & Helper Kepatuhan Jadwal Timeline Subtask (Pure Function, aman di Client & Server).
// Mendeteksi subtask tanpa jadwal rencana (daily_plan), tanpa PIC, dan menyediakan auto-distribute.

export const MANDATORY_SYSTEM_CATEGORY_ID = 'cat_sys_wajib';

/**
 * Normalisasi struktur planning proyek dari berbagai format (string JSON, object wrap, array).
 * @param {any} input
 * @returns {Array} Array of categories
 */
export function normalizeCategories(input) {
  if (!input) return [];
  let parsed = input;
  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input);
    } catch {
      return [];
    }
  }
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.categories)) return parsed.categories;
  return [];
}

/**
 * Cek apakah sebuah subtask aktif (memiliki volume > 0, qty > 0, atau riwayat plan/actual).
 * @param {object} sub
 * @returns {boolean}
 */
export function isSubtaskActive(sub) {
  if (!sub || typeof sub !== 'object') return false;
  if (sub.nonaktif === true) return false;

  const vol = parseFloat(sub.volume ?? sub.target_qty ?? sub.qty ?? 0);
  if (vol > 0) return true;

  if (sub.daily_plan && typeof sub.daily_plan === 'object') {
    const hasPlan = Object.values(sub.daily_plan).some((v) => parseFloat(v) > 0);
    if (hasPlan) return true;
  }

  if (sub.daily_actual && typeof sub.daily_actual === 'object') {
    const hasActual = Object.values(sub.daily_actual).some((v) => parseFloat(v) > 0);
    if (hasActual) return true;
  }

  // Jika memiliki nama pekerjaan tapi volume belum diisi, tetap dianggap aktif bila bukan baris kosong murni
  const name = typeof sub.name === 'string' ? sub.name.trim() : (typeof sub.activity_name === 'string' ? sub.activity_name.trim() : '');
  return name.length > 0;
}

/**
 * Cek apakah subtask memiliki jadwal rencana yang valid (daily_plan terisi atau tanggal mulai & selesai valid).
 * @param {object} sub
 * @returns {boolean}
 */
export function hasValidSchedule(sub) {
  if (!sub || typeof sub !== 'object') return false;

  // 1. Cek isi daily_plan (sumber kebenaran utama jadwal harian)
  if (sub.daily_plan && typeof sub.daily_plan === 'object') {
    const hasPositivePlan = Object.entries(sub.daily_plan).some(([dateKey, val]) => {
      return Boolean(dateKey && dateKey.trim().length >= 8 && parseFloat(val) > 0);
    });
    if (hasPositivePlan) return true;
  }

  // 2. Fallback cek tanggal eksplisit start_date & end_date
  const start = sub.start_date || sub.start || null;
  const end = sub.end_date || sub.end || sub.target_date || null;
  if (start && end && String(start).slice(0, 10) <= String(end).slice(0, 10)) {
    return true;
  }

  return false;
}

/**
 * Ekstrak rentang tanggal jadwal dari subtask (daily_plan atau start/end date).
 * @param {object} sub
 * @returns {{ start_date: string|null, end_date: string|null, workDaysCount: number }}
 */
export function deriveSubtaskScheduleWindow(sub) {
  if (!sub || typeof sub !== 'object') {
    return { start_date: null, end_date: null, workDaysCount: 0 };
  }

  const planKeys = Object.keys(sub.daily_plan || {})
    .filter((k) => parseFloat(sub.daily_plan[k]) > 0)
    .sort();

  if (planKeys.length > 0) {
    return {
      start_date: planKeys[0],
      end_date: planKeys[planKeys.length - 1],
      workDaysCount: planKeys.length
    };
  }

  const start = sub.start_date || sub.start ? String(sub.start_date || sub.start).slice(0, 10) : null;
  const end = sub.end_date || sub.end || sub.target_date ? String(sub.end_date || sub.end || sub.target_date).slice(0, 10) : start;

  return {
    start_date: start,
    end_date: end,
    workDaysCount: start && end ? Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1) : 0
  };
}

/**
 * Cek apakah subtask memiliki nama PIC/Mandor yang sah.
 * @param {object} sub
 * @returns {boolean}
 */
export function hasValidPic(sub) {
  if (!sub || typeof sub !== 'object') return false;
  const rawPic = sub.pic || sub.mandor || sub.pekerja;
  if (!rawPic) return false;
  const pic = typeof rawPic === 'string' ? rawPic.trim() : (typeof rawPic === 'object' ? (rawPic.nama || rawPic.name || '') : '');
  if (!pic) return false;
  const lower = pic.toLowerCase();
  if (lower === '-' || lower === 'none' || lower === 'pic...' || lower === 'pic…' || lower === 'mandor...' || lower === 'mandor…') {
    return false;
  }
  return true;
}

/**
 * Evaluasi satu subtask untuk keperluan penginputan Laporan Harian (G_LAPOR_SUBTASK_SCHEDULE).
 * @param {object} subtask
 * @returns {{ allowed: boolean, isScheduled: boolean, message: string }}
 */
export function evaluateSubtaskForReport(subtask) {
  if (!subtask) {
    return { allowed: true, isScheduled: false, message: 'Subtask tidak valid' };
  }
  const isScheduled = hasValidSchedule(subtask);
  if (!isScheduled) {
    const name = subtask.name || subtask.activity || 'Subtask';
    return {
      allowed: false,
      isScheduled: false,
      message: `Subtask "${name}" belum dijadwalkan di Timeline (jadwal rencana harian masih kosong). Tentukan tanggal mulai dan selesai sebelum mengisi progres.`
    };
  }
  return {
    allowed: true,
    isScheduled: true,
    message: 'Subtask sudah terjadwal.'
  };
}

/**
 * Evaluasi kepatuhan jadwal seluruh subtask dalam sebuah proyek.
 * Digunakan untuk Gate G_PRJ_KICKOFF_SCHEDULE (Kickoff proyek) & G_TIMELINE_BUDGET.
 *
 * @param {any} planningOrCategories Data timeline planning proyek
 * @param {object} [options]
 * @param {boolean} [options.excludeSystemCategory=true] Abaikan kategori sistem wajib (mobilisasi/demobilisasi)
 * @param {boolean} [options.requirePic=true] Evaluasi kelengkapan PIC
 * @param {number} [options.minScheduledPct=100] Minimal % subtask yang harus terjadwal agar lulus (default 100%)
 * @returns {object}
 */
export function evaluateProjectScheduleDiscipline(planningOrCategories, options = {}) {
  const {
    excludeSystemCategory = true,
    requirePic = true,
    minScheduledPct = 100
  } = options;

  const categories = normalizeCategories(planningOrCategories);

  if (categories.length === 0) {
    return {
      passed: false,
      status: 'failed',
      totalActiveSubtasks: 0,
      scheduledCount: 0,
      unscheduledCount: 0,
      scheduledPct: 0,
      unscheduledSubtasks: [],
      missingPics: [],
      missingPicCount: 0,
      message: 'Timeline proyek belum memiliki kategori pekerjaan.'
    };
  }

  const unscheduledSubtasks = [];
  const missingPics = [];
  let totalActiveSubtasks = 0;
  let scheduledCount = 0;

  categories.forEach((cat, catIdx) => {
    const isSys = cat.id === MANDATORY_SYSTEM_CATEGORY_ID || cat.is_system;
    if (excludeSystemCategory && isSys) return;

    const catName = cat.name || `Kategori #${catIdx + 1}`;
    const subtasks = Array.isArray(cat.subtasks) ? cat.subtasks : [];

    subtasks.forEach((sub, subIdx) => {
      if (!isSubtaskActive(sub)) return;

      totalActiveSubtasks++;
      const subName = sub.name || sub.activity_name || `Subtask #${subIdx + 1}`;
      const subId = sub.id || `${cat.id || catIdx}_${subIdx}`;
      const scheduled = hasValidSchedule(sub);

      if (scheduled) {
        scheduledCount++;
      } else {
        unscheduledSubtasks.push({
          catId: cat.id || `cat_${catIdx}`,
          catName,
          subId,
          subName,
          volume: sub.volume ?? sub.target_qty ?? 0,
          unit: sub.unit ?? sub.satuan ?? ''
        });
      }

      if (requirePic && !hasValidPic(sub)) {
        missingPics.push({
          catId: cat.id || `cat_${catIdx}`,
          catName,
          subId,
          subName
        });
      }
    });
  });

  const scheduledPct = totalActiveSubtasks > 0
    ? Math.round((scheduledCount / totalActiveSubtasks) * 100)
    : 100;

  const passed = totalActiveSubtasks > 0 && scheduledPct >= minScheduledPct;

  let message = 'Seluruh subtask aktif telah memiliki jadwal kerja.';
  if (unscheduledSubtasks.length > 0) {
    const names = unscheduledSubtasks.slice(0, 3).map((s) => `"${s.subName}"`).join(', ');
    const more = unscheduledSubtasks.length > 3 ? ` dan ${unscheduledSubtasks.length - 3} lainnya` : '';
    message = `${unscheduledSubtasks.length} dari ${totalActiveSubtasks} subtask belum dijadwalkan (${names}${more}). Lengkapi jadwal harian di tab Timeline.`;
  }

  return {
    passed,
    status: passed ? 'passed' : 'failed',
    totalActiveSubtasks,
    scheduledCount,
    unscheduledCount: unscheduledSubtasks.length,
    scheduledPct,
    unscheduledSubtasks,
    missingPics,
    missingPicCount: missingPics.length,
    message
  };
}

/**
 * Helper pintar pembagi volume otomatis ke hari kerja aktif antara startDate dan endDate.
 * Menghasilkan objek `daily_plan` baru: `{ "2026-10-20": 25, "2026-10-21": 25, ... }`
 *
 * @param {number|string} totalVolume Total volume subtask (mis. 100)
 * @param {string} startDate Tanggal mulai format YYYY-MM-DD
 * @param {string} endDate Tanggal selesai format YYYY-MM-DD
 * @param {object} [options]
 * @param {Set<string>|Array<string>} [options.holidays] Daftar hari libur
 * @param {boolean} [options.skipSunday=true] Lewati hari Minggu
 * @returns {Record<string, number>}
 */
export function autoDistributePlanVolume(totalVolume, startDate, endDate, options = {}) {
  const vol = parseFloat(totalVolume || 0);
  if (vol <= 0 || !startDate || !endDate) return {};

  const holidays = options.holidays instanceof Set ? options.holidays : new Set(options.holidays || []);
  const skipSunday = options.skipSunday !== false;

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return {};

  const workDates = [];
  const cur = new Date(start);
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const d = String(cur.getDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;

    const isSunday = cur.getDay() === 0;
    const isHoliday = holidays.has(dateStr);

    if (!(skipSunday && isSunday) && !isHoliday) {
      workDates.push(dateStr);
    }
    cur.setDate(cur.getDate() + 1);
  }

  if (workDates.length === 0) {
    // Jika semua hari jatuh di hari libur, gunakan minimal start_date
    const y = start.getFullYear();
    const m = String(start.getMonth() + 1).padStart(2, '0');
    const d = String(start.getDate()).padStart(2, '0');
    return { [`${y}-${m}-${d}`]: Math.round(vol * 100) / 100 };
  }

  const perDay = Math.floor((vol / workDates.length) * 100) / 100;
  let remainder = Math.round((vol - (perDay * workDates.length)) * 100) / 100;

  const result = {};
  workDates.forEach((dateKey, idx) => {
    let dayVol = perDay;
    if (idx === workDates.length - 1) {
      dayVol = Math.round((dayVol + remainder) * 100) / 100;
    }
    result[dateKey] = dayVol;
  });

  return result;
}
