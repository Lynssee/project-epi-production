// src/lib/utils/universalHelpSearch.ts
// Mesin pencarian terpadu 4-in-1 untuk Dashboard Lapangan (project-epi)
// Mencari serentak ke: Modul Panduan, Peta Alur Bisnis, Dokumen SOP K3, dan FAQ Kendala

export function stripHtml(html: string): string {
  if (!html) return '';
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function makeSnippet(text: string, keyword: string, maxLen = 120): string {
  if (!text) return '';
  const clean = stripHtml(text);
  if (!keyword) return clean.slice(0, maxLen) + (clean.length > maxLen ? '…' : '');
  const idx = clean.toLowerCase().indexOf(keyword.toLowerCase());
  if (idx === -1) return clean.slice(0, maxLen) + (clean.length > maxLen ? '…' : '');
  const start = Math.max(0, idx - 40);
  const end = Math.min(clean.length, idx + keyword.length + 60);
  return (start > 0 ? '…' : '') + clean.slice(start, end) + (end < clean.length ? '…' : '');
}

export interface HelpSearchResult {
  type: 'modul' | 'alur' | 'sop' | 'faq';
  typeLabel: string;
  icon: string;
  badgeColor: string;
  title: string;
  subtitle: string;
  snippet: string;
  data: any;
}

export function searchHelpEntities(
  query: string,
  sources: {
    modulDokumentasi?: any[];
    processFlows?: any[];
    companySops?: any[];
    faqs?: any[];
  } = {}
): HelpSearchResult[] {
  const q = (query || '').toLowerCase().trim();
  if (!q) return [];

  const list: HelpSearchResult[] = [];
  const { modulDokumentasi = [], processFlows = [], companySops = [], faqs = [] } = sources;

  // 1. Modul Panduan
  modulDokumentasi.forEach((m) => {
    const nama = m.nama || '';
    const desc = m.deskripsi || '';
    const langkahMatch = (m.langkah || []).find(
      (l: any) => l.judul?.toLowerCase().includes(q) || l.isi?.toLowerCase().includes(q)
    );

    if (nama.toLowerCase().includes(q) || desc.toLowerCase().includes(q) || langkahMatch) {
      list.push({
        type: 'modul',
        typeLabel: 'Panduan Modul',
        icon: '📘',
        badgeColor: 'bg-blue-100 text-blue-800 border-blue-200',
        title: nama,
        subtitle: langkahMatch ? `Langkah: ${langkahMatch.judul}` : desc,
        snippet: makeSnippet(langkahMatch ? langkahMatch.isi : desc, q),
        data: m
      });
    }
  });

  // 2. Peta Alur Bisnis (Flows & Nodes)
  processFlows.forEach((f) => {
    const title = f.title || '';
    const desc = f.description || '';
    const sopCode = f.sop_code || f.doc_number || '';
    const matchingNode = (f.nodes || []).find(
      (n: any) => n.label?.toLowerCase().includes(q) || n.description?.toLowerCase().includes(q) || n.pic?.toLowerCase().includes(q)
    );

    if (title.toLowerCase().includes(q) || desc.toLowerCase().includes(q) || sopCode.toLowerCase().includes(q) || matchingNode) {
      list.push({
        type: 'alur',
        typeLabel: 'Peta Alur Bisnis',
        icon: '🗺️',
        badgeColor: 'bg-emerald-100 text-emerald-800 border-emerald-200',
        title: title,
        subtitle: matchingNode ? `Langkah: ${matchingNode.label} (PIC: ${matchingNode.pic || matchingNode.role || '—'})` : (sopCode ? `Kode SOP: ${sopCode}` : desc),
        snippet: makeSnippet(matchingNode ? matchingNode.description || matchingNode.label : desc, q),
        data: { flow: f, node: matchingNode }
      });
    }
  });

  // 3. Dokumen SOP Resmi & K3
  companySops.forEach((s) => {
    const code = s.sop_code || '';
    const title = s.title || '';
    const dept = s.department || '';
    const desc = s.description || s.purpose || s.scope || '';

    if (code.toLowerCase().includes(q) || title.toLowerCase().includes(q) || dept.toLowerCase().includes(q) || desc.toLowerCase().includes(q)) {
      list.push({
        type: 'sop',
        typeLabel: 'SOP & K3',
        icon: '📜',
        badgeColor: 'bg-indigo-100 text-indigo-800 border-indigo-200',
        title: `${code ? code + ' — ' : ''}${title}`,
        subtitle: `Departemen: ${dept || 'K3/Operasional'} · Rev: ${s.version_seq || s.revision_status || '1.0'}`,
        snippet: makeSnippet(desc || title, q),
        data: s
      });
    }
  });

  // 4. FAQ & Kendala Operasional Lapangan
  faqs.forEach((faq) => {
    const tanya = faq.tanya || '';
    const jawab = faq.jawab || '';
    const modulNama = faq.modulNama || 'Umum';

    if (tanya.toLowerCase().includes(q) || jawab.toLowerCase().includes(q)) {
      list.push({
        type: 'faq',
        typeLabel: 'Kendala & FAQ',
        icon: '❓',
        badgeColor: 'bg-amber-100 text-amber-800 border-amber-200',
        title: tanya,
        subtitle: `Modul: ${modulNama}`,
        snippet: makeSnippet(jawab, q),
        data: faq
      });
    }
  });

  return list;
}
