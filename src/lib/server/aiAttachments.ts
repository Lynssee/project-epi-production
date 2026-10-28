// src/lib/server/aiAttachments.ts
// SERVER-ONLY. Port TypeScript dari lib/server/aiAttachments.js (erp-epi-1) —
// ubah attachment (base64 dari klien) jadi content block OpenAI-style dipakai
// OpenRouter (bukan format Anthropic native type:'image'/'document').
// implementation_plan_asisten_ai_v2.md §1.2/§1.4.
//
// §7#4 — tiap lampiran JUGA diunggah ke Directus /files (directusServerUpload),
// file id disimpan di meta.fileId supaya riwayat percakapan bisa menampilkan
// lampiran asli setelah reload. Upload non-fatal: gagal upload -> fileId null.

import { directusServerUpload } from './directus';

export const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']);
export const MAX_FILE_BYTES = 6 * 1024 * 1024; // 6 MB per file
export const MAX_FILES = 3;
const MAX_TEXT_CHARS = 60_000;

async function uploadAttachmentAsset(bytes: Buffer, mime: string, name: string): Promise<string | null> {
	try {
		const form = new FormData();
		// Uint8Array.from() menyalin ke ArrayBuffer baru (bukan Buffer.buffer yang
		// bertipe ArrayBufferLike/SharedArrayBuffer) — BlobPart di lib TS DOM terbaru
		// tidak menerima Buffer langsung.
		form.append('file', new Blob([Uint8Array.from(bytes)], { type: mime || 'application/octet-stream' }), name || 'lampiran');
		const res = await directusServerUpload(form);
		if (!res.ok) return null;
		const data = await res.json().catch(() => null);
		return data?.data?.id || null;
	} catch (e: any) {
		console.error('[aiAttachments] gagal unggah ke Directus assets (non-fatal):', e?.message);
		return null;
	}
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
	const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
	const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: true }).promise;
	let text = '';
	for (let i = 1; i <= doc.numPages; i++) {
		const page = await doc.getPage(i);
		const content = await page.getTextContent();
		text += content.items.map((it: any) => it.str).join(' ') + '\n';
	}
	return text.trim();
}

function decodeBase64(base64: string | undefined): Buffer {
	return Buffer.from(String(base64 || '').replace(/^data:[^,]+,/, ''), 'base64');
}

export type AttachmentInput = { name: string; mime: string; base64: string };
export type AttachmentMeta = { name: string; mime: string; kind: 'image' | 'pdf' | 'text'; size: number; fileId: string | null };

export async function buildAttachmentParts(
	attachments: AttachmentInput[]
): Promise<{ parts: any[]; meta: AttachmentMeta[]; hasImage: boolean }> {
	const list = Array.isArray(attachments) ? attachments.slice(0, MAX_FILES) : [];
	const parts: any[] = [];
	const meta: AttachmentMeta[] = [];
	let hasImage = false;

	for (const att of list) {
		const name = String(att?.name || 'lampiran').slice(0, 200);
		const mime = String(att?.mime || '').toLowerCase();
		const bytes = decodeBase64(att?.base64);
		if (!bytes.length) continue;
		if (bytes.length > MAX_FILE_BYTES) {
			throw new Error(`Lampiran "${name}" melebihi batas ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
		}

		if (IMAGE_MIME.has(mime)) {
			hasImage = true;
			const fileId = await uploadAttachmentAsset(bytes, mime, name);
			parts.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${bytes.toString('base64')}` } });
			meta.push({ name, mime, kind: 'image', size: bytes.length, fileId });
		} else if (mime === 'application/pdf' || /\.pdf$/i.test(name)) {
			const fileId = await uploadAttachmentAsset(bytes, mime || 'application/pdf', name);
			let text = '';
			try {
				text = await extractPdfText(bytes);
			} catch (e: any) {
				console.error('[aiAttachments] gagal ekstrak PDF:', e?.message);
			}
			if (!text) {
				parts.push({ type: 'text', text: `[Lampiran PDF: ${name}] — teks tidak bisa diekstrak (kemungkinan hasil scan/gambar).` });
			} else {
				parts.push({ type: 'text', text: `[Isi lampiran PDF: ${name}]\n${text.slice(0, MAX_TEXT_CHARS)}` });
			}
			meta.push({ name, mime: mime || 'application/pdf', kind: 'pdf', size: bytes.length, fileId });
		} else if (mime.startsWith('text/') || /\.(csv|txt|tsv)$/i.test(name)) {
			const fileId = await uploadAttachmentAsset(bytes, mime || 'text/plain', name);
			const text = bytes.toString('utf-8').slice(0, MAX_TEXT_CHARS);
			parts.push({ type: 'text', text: `[Isi lampiran ${name}]\n${text}` });
			meta.push({ name, mime: mime || 'text/plain', kind: 'text', size: bytes.length, fileId });
		} else {
			throw new Error(`Tipe lampiran "${name}" tidak didukung. Gunakan gambar (PNG/JPG/WebP), PDF, atau teks (CSV/TXT).`);
		}
	}

	return { parts, meta, hasImage };
}
