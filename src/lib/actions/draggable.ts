export function draggable(node: HTMLElement, options: { enable?: boolean } = {}) {
	if (options.enable === false) return;

	let x: number;
	let y: number;
	let initialX: number;
	let initialY: number;
	let isDragging = false;
	
	function handleMousedown(event: MouseEvent | TouchEvent) {
		// Avoid drag if user is clicking on interactive elements
		if (
			event.target instanceof HTMLElement &&
			(event.target.tagName === 'BUTTON' ||
				event.target.closest('button') ||
				event.target.tagName === 'A' ||
				event.target.closest('a') ||
				event.target.tagName === 'INPUT' ||
				event.target.tagName === 'SVG' ||
				event.target.closest('svg'))
		) {
			// Don't return if it's the toolbar itself or not a button
            if (event.target.tagName === 'BUTTON' || event.target.closest('button') || event.target.tagName === 'A' || event.target.closest('a') || event.target.tagName === 'INPUT') {
                return;
            }
		}

		if (event.type === 'touchstart') {
			x = (event as TouchEvent).touches[0].clientX;
			y = (event as TouchEvent).touches[0].clientY;
		} else {
			x = (event as MouseEvent).clientX;
			y = (event as MouseEvent).clientY;
		}
		
		initialX = x;
		initialY = y;
		isDragging = true;
		
		node.style.cursor = 'grabbing';

		window.addEventListener('mousemove', handleMousemove);
		window.addEventListener('mouseup', handleMouseup);
		window.addEventListener('touchmove', handleMousemove, { passive: false });
		window.addEventListener('touchend', handleMouseup);
	}

	function handleMousemove(event: MouseEvent | TouchEvent) {
		if (!isDragging) return;
		
		let clientX, clientY;
		if (event.type === 'touchmove') {
			clientX = (event as TouchEvent).touches[0].clientX;
			clientY = (event as TouchEvent).touches[0].clientY;
			// Prevent default scrolling on touch devices while dragging
			if (event.cancelable) event.preventDefault();
		} else {
			clientX = (event as MouseEvent).clientX;
			clientY = (event as MouseEvent).clientY;
		}
		
		const dx = clientX - x;
		const dy = clientY - y;
		x = clientX;
		y = clientY;
		
		// Get current transform
		const style = window.getComputedStyle(node);
		const matrix = new DOMMatrixReadOnly(style.transform === 'none' ? 'matrix(1, 0, 0, 1, 0, 0)' : style.transform);
		const currentTranslateX = matrix.m41;
		const currentTranslateY = matrix.m42;
		
		const newX = currentTranslateX + dx;
		const newY = currentTranslateY + dy;

		node.style.transform = `translate(${newX}px, ${newY}px)`;
	}

	function handleMouseup(event: MouseEvent | TouchEvent) {
		if (!isDragging) return;
		isDragging = false;
		node.style.cursor = 'grab';

		window.removeEventListener('mousemove', handleMousemove);
		window.removeEventListener('mouseup', handleMouseup);
		window.removeEventListener('touchmove', handleMousemove);
		window.removeEventListener('touchend', handleMouseup);
	}

	node.style.cursor = 'grab';
	node.addEventListener('mousedown', handleMousedown);
	node.addEventListener('touchstart', handleMousedown, { passive: true });

	return {
		update(newOptions: { enable?: boolean }) {
			if (newOptions.enable === false) {
				node.removeEventListener('mousedown', handleMousedown);
				node.removeEventListener('touchstart', handleMousedown);
				node.style.cursor = '';
			} else {
				node.style.cursor = 'grab';
				node.addEventListener('mousedown', handleMousedown);
				node.addEventListener('touchstart', handleMousedown, { passive: true });
			}
		},
		destroy() {
			node.removeEventListener('mousedown', handleMousedown);
			node.removeEventListener('touchstart', handleMousedown);
			window.removeEventListener('mousemove', handleMousemove);
			window.removeEventListener('mouseup', handleMouseup);
			window.removeEventListener('touchmove', handleMousemove);
			window.removeEventListener('touchend', handleMouseup);
		}
	};
}
