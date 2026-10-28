// src/lib/utils/autoDraft.ts
// Kembaran erp-epi/src/lib/utils/autoDraft.js — logika HARUS tetap sinkron. Lihat
// file itu untuk penjelasan lengkap arsitektur Lapis 1.
import { get } from 'svelte/store';
import { authStore } from '$lib/stores/auth';
import {
	DEFAULT_TTL_MS,
	readEnvelope,
	readSavedAt,
	removeEnvelope,
	writeEnvelope
} from './draftStorage';

const DEBOUNCE_MS = 700;

const registry = new Map<string, { flush: () => void }>();
let globalListenersBound = false;
let scopeCounter = 0;

function currentUserId(): string {
	return get(authStore).user?.uid || 'anon';
}

function routeKey(): string {
	return typeof location === 'undefined' ? '' : location.pathname;
}

type CapturableEl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function isCapturableElement(el: EventTarget | null): el is CapturableEl {
	if (
		!(
			el instanceof HTMLInputElement ||
			el instanceof HTMLTextAreaElement ||
			el instanceof HTMLSelectElement
		)
	) {
		return false;
	}
	if (el.type === 'file' || el.type === 'password') return false;
	if (el.getAttribute && el.getAttribute('data-draft') === 'off') return false;
	return true;
}

function collectFields(root: HTMLElement): CapturableEl[] {
	return Array.from(root.querySelectorAll('input, textarea, select')).filter(
		isCapturableElement
	) as CapturableEl[];
}

function fieldKey(el: CapturableEl, index: number): string {
	return (
		el.name ||
		el.id ||
		el.getAttribute('data-draft-field') ||
		`${el.tagName.toLowerCase()}:${(el as HTMLInputElement).type || ''}:${index}`
	);
}

function readFieldValue(el: CapturableEl): string | boolean {
	if (el instanceof HTMLInputElement && el.type === 'checkbox') return el.checked;
	return el.value;
}

function captureSnapshot(root: HTMLElement): Record<string, unknown> {
	const fields = collectFields(root);
	const snapshot: Record<string, unknown> = {};
	for (let i = 0; i < fields.length; i++) {
		const el = fields[i];
		const key = fieldKey(el, i);
		if (el instanceof HTMLInputElement && el.type === 'radio') {
			if (el.checked) snapshot[key] = el.value;
			continue;
		}
		snapshot[key] = readFieldValue(el);
	}
	return snapshot;
}

function applySnapshot(root: HTMLElement, snapshot: Record<string, unknown>) {
	const fields = collectFields(root);
	for (let i = 0; i < fields.length; i++) {
		const el = fields[i];
		const key = fieldKey(el, i);
		if (!(key in snapshot)) continue;
		const value = snapshot[key];
		if (el instanceof HTMLInputElement && el.type === 'checkbox') {
			el.checked = Boolean(value);
		} else if (el instanceof HTMLInputElement && el.type === 'radio') {
			el.checked = el.value === value;
		} else {
			(el as HTMLInputElement | HTMLTextAreaElement).value = (value as string) ?? '';
		}
		el.dispatchEvent(new Event('input', { bubbles: true }));
		el.dispatchEvent(new Event('change', { bubbles: true }));
	}
}

function scopeIdOf(node: HTMLElement, fallbackIndex: number): string {
	return (
		node.getAttribute('data-draft-scope') ||
		node.id ||
		node.getAttribute('name') ||
		`scope-${fallbackIndex}`
	);
}

function storageKeyFor(scopeId: string): string {
	return `draft:autoDraft:${routeKey()}:${scopeId}:${currentUserId()}`;
}

function bindGlobalFlushListeners() {
	if (globalListenersBound || typeof window === 'undefined') return;
	globalListenersBound = true;
	const flushAll = () => {
		for (const entry of registry.values()) entry.flush();
	};
	window.addEventListener('pagehide', flushAll);
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'hidden') flushAll();
	});
	window.addEventListener('error', flushAll);
	window.addEventListener('unhandledrejection', flushAll);
}

export interface AutoDraftRestoreInfo {
	savedAt: number | null;
	apply: () => void;
	discard: () => void;
}

export interface AutoDraftOptions {
	ttlMs?: number;
	onRestoreAvailable?: (info: AutoDraftRestoreInfo) => void;
}

export function autoDraft(node: HTMLElement, opts: AutoDraftOptions = {}) {
	bindGlobalFlushListeners();

	const scopeId = scopeIdOf(node, scopeCounter++);
	const storageKey = storageKeyFor(scopeId);
	const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;

	let debounceId: ReturnType<typeof setTimeout> | null = null;
	let restoring = false;

	function flush() {
		if (debounceId) {
			clearTimeout(debounceId);
			debounceId = null;
		}
		if (restoring) return;
		writeEnvelope(storageKey, captureSnapshot(node), ttlMs);
	}

	function scheduleFlush() {
		if (restoring) return;
		if (debounceId) clearTimeout(debounceId);
		debounceId = setTimeout(flush, DEBOUNCE_MS);
	}

	function onInputOrChange(e: Event) {
		if (!isCapturableElement(e.target)) return;
		scheduleFlush();
	}

	function onClickCapture(e: Event) {
		if (e.target instanceof HTMLInputElement && e.target.type === 'file') flush();
	}

	node.addEventListener('input', onInputOrChange);
	node.addEventListener('change', onInputOrChange);
	node.addEventListener('click', onClickCapture, true);

	registry.set(storageKey, { flush });

	const existing = readEnvelope<Record<string, unknown>>(storageKey);
	if (existing && opts.onRestoreAvailable) {
		opts.onRestoreAvailable({
			savedAt: readSavedAt(storageKey),
			apply: () => {
				restoring = true;
				applySnapshot(node, existing);
				setTimeout(() => {
					restoring = false;
				}, 0);
			},
			discard: () => removeEnvelope(storageKey)
		});
	}

	return {
		destroy() {
			node.removeEventListener('input', onInputOrChange);
			node.removeEventListener('change', onInputOrChange);
			node.removeEventListener('click', onClickCapture, true);
			registry.delete(storageKey);
			if (debounceId) clearTimeout(debounceId);
		}
	};
}

export function clearAutoDraft(nodeOrScopeId: HTMLElement | string) {
	const scopeId =
		typeof nodeOrScopeId === 'string'
			? nodeOrScopeId
			: nodeOrScopeId.getAttribute('data-draft-scope') ||
				nodeOrScopeId.id ||
				nodeOrScopeId.getAttribute('name');
	if (!scopeId) {
		console.warn(
			'[autoDraft] clearAutoDraft: tidak bisa menentukan scope id (elemen tanpa data-draft-scope/id/name). Draf tidak dihapus.'
		);
		return;
	}
	removeEnvelope(storageKeyFor(scopeId));
}
