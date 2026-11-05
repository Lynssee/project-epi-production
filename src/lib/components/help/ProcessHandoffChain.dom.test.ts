// @vitest-environment jsdom
// Kartu Rantai Serah-Terima (lapangan): hulu/hilir, tombol lompat, pengingat bawah, kosong tidak tampil; integrasi di panduan mobile.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import ProcessHandoffChain from './ProcessHandoffChain.svelte';
import ProcessGuidanceMobile from './ProcessGuidanceMobile.svelte';
import { PROCESS_FLOWS } from '$lib/data/processGuidance';

let box: HTMLElement | null, inst: any;
afterEach(() => { if (inst) unmount(inst); box?.remove(); inst = box = null; document.body.innerHTML = ''; });
function render(C: any, props: any) {
	Element.prototype.scrollIntoView = () => {};
	box = document.createElement('div');
	document.body.appendChild(box);
	inst = mount(C, { target: box, props });
	flushSync();
}
const it_ = (o: any = {}) => ({ code: 'H19', doc_label: 'BAST Disetujui Klien', handoff_type: 'dokumen', own_node_id: 'n1', own_node_label: 'Langkah Saya', flow_id: 'f9', flow_title: 'Alur Finance', node_id: 'ar', node_label: 'Draft Invoice', ...o });
const CH = { upstream: [it_({ code: 'H11', doc_label: 'Cat ke Site', handoff_type: 'barang', flow_id: 'f1', flow_title: 'Alur Gudang' })], downstream: [it_()] };

describe('ProcessHandoffChain', () => {
	it('mode full: hulu & hilir dengan dokumen, jenis, alur seberang, dan hint penggunaan', () => {
		render(ProcessHandoffChain, { chain: CH });
		const t = box!.textContent!;
		expect(t).toContain('Diterima dari (Hulu)');
		expect(t).toContain('Diserahkan ke (Hilir)');
		expect(t).toContain('Alur Gudang');
		expect(t).toContain('BAST Disetujui Klien');
		expect(t).toContain('Barang');
		expect(t).toContain('Draft Invoice');
		expect(t).toContain('Setelah selesai');
	});
	it('tombol lompat memanggil onjump(alur, langkah) seberang', () => {
		const onjump = vi.fn();
		render(ProcessHandoffChain, { chain: CH, onjump });
		const btns = [...box!.querySelectorAll('button')].filter((b) => b.textContent!.includes('Buka alur ini'));
		btns[0].click();
		btns[1].click();
		expect(onjump).toHaveBeenNthCalledWith(1, 'f1', 'node_id' in CH.upstream[0] ? CH.upstream[0].node_id : '');
		expect(onjump).toHaveBeenNthCalledWith(2, 'f9', 'ar');
	});
	it('mode hilir: pengingat satu kalimat + tombol; tanpa hilir tidak tampil', () => {
		const onjump = vi.fn();
		render(ProcessHandoffChain, { chain: CH, mode: 'hilir', onjump });
		expect(box!.querySelector('[data-testid="handoff-hint"]')!.textContent).toContain('Alur Finance');
		(box!.querySelector('button') as HTMLElement).click();
		expect(onjump).toHaveBeenCalledWith('f9', 'ar');
		unmount(inst); box!.remove();
		render(ProcessHandoffChain, { chain: { upstream: CH.upstream, downstream: [] }, mode: 'hilir' });
		expect(box!.querySelector('[data-testid^="handoff-chain"]')).toBeNull();
	});
	it('chain null / kosong → tidak menampilkan apa pun', () => {
		render(ProcessHandoffChain, { chain: null });
		expect(box!.querySelector('[data-testid^="handoff-chain"]')).toBeNull();
		unmount(inst); box!.remove();
		render(ProcessHandoffChain, { chain: { upstream: [], downstream: [] } });
		expect(box!.querySelector('[data-testid^="handoff-chain"]')).toBeNull();
	});
});

describe('ProcessGuidanceMobile + rantai', () => {
	const flow = PROCESS_FLOWS[0];
	it('kartu atas & pengingat bawah tampil; tanpa chain tampilan lama tidak berubah', () => {
		render(ProcessGuidanceMobile, { flow, chain: CH });
		expect(box!.querySelector('[data-testid="handoff-chain-full"]')).not.toBeNull();
		expect(box!.querySelector('[data-testid="handoff-chain-hilir"]')).not.toBeNull();
		unmount(inst); box!.remove();
		render(ProcessGuidanceMobile, { flow });
		expect(box!.querySelector('[data-testid^="handoff-chain"]')).toBeNull();
		expect(box!.querySelectorAll('section').length).toBe(4);
	});
	it('langkah yang terlibat menampilkan syarat awal / siapa yang menunggu hasilnya saat dibuka', () => {
		const nodeId = flow.nodes[1].id;
		const chain = { upstream: [it_({ own_node_id: nodeId, doc_label: 'Syarat X', flow_title: 'Alur Hulu' })], downstream: [it_({ own_node_id: nodeId, doc_label: 'Hasil Y', flow_title: 'Alur Hilir' })] };
		render(ProcessGuidanceMobile, { flow, chain, fokus: nodeId });
		const t = box!.querySelector(`#pg-node-${nodeId}`)!.textContent!;
		expect(t).toContain('Syarat awal');
		expect(t).toContain('Syarat X');
		expect(t).toContain('ditunggu oleh');
		expect(t).toContain('Alur Hilir');
	});
});
