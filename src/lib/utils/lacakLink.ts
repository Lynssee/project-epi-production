// src/lib/utils/lacakLink.ts
// Penguraian tautan pelacakan publik erp-epi (client-safe, murni). Dipakai kolom "tempel tautan" dan pemindai kamera.
// Menerima: URL penuh (https://internal.eltamaprimaindo.com/lacak/sj/672?h=...), path (/lacak/sj/672?h=...),
// atau yang ditempel bersama teks WhatsApp (URL diambil dari kalimat).

export interface ParsedLacak {
	jenis: 'sj' | 'mutasi' | 'pl' | 'bk' | 'trf' | 'produksi' | 'fleet' | 'maintenance' | 'komplain' | 'returgudang';
	id: string;
	sig: string;
}

const RE = /\/lacak\/(sj|mutasi|pl|bk|trf|produksi|fleet|maintenance|komplain|returgudang)\/([1-9]\d{0,11}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\?(?:[^\s#]*&)?h=([A-Za-z0-9_-]{22})(?![A-Za-z0-9_-])/;

export function parseLacakLink(text: unknown): ParsedLacak | null {
	if (typeof text !== 'string' || text.length > 2000) return null;
	const m = RE.exec(text);
	return m ? { jenis: m[1] as ParsedLacak['jenis'], id: m[2], sig: m[3] } : null;
}

/** Path jembatan di aplikasi Lapangan untuk tautan hasil parse. */
export const lacakBridgePath = (p: ParsedLacak): string => `/lacak/${p.jenis}/${p.id}?h=${p.sig}`;
