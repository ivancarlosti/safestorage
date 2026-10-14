'use client';

import type { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react';
import { useMemo, useRef } from 'react';

type LongPressOptions = {
	threshold?: number;
	onStart?: (event: ReactMouseEvent | ReactTouchEvent) => void;
	onFinish?: (event: ReactMouseEvent | ReactTouchEvent) => void;
	onCancel?: (event: ReactMouseEvent | ReactTouchEvent) => void;
};

type LongPressHandlers = {
	onMouseDown: (event: ReactMouseEvent | ReactTouchEvent) => void;
	onMouseUp: (event: ReactMouseEvent | ReactTouchEvent) => void;
	onMouseLeave: (event: ReactMouseEvent | ReactTouchEvent) => void;
	onTouchStart: (event: ReactMouseEvent | ReactTouchEvent) => void;
	onTouchEnd: (event: ReactMouseEvent | ReactTouchEvent) => void;
};

/*
	Local replacement for `useLongPress` from `@uidotdev/usehooks` (the only hook
	used from that package), so the dependency can be dropped. The behaviour is
	ported verbatim from the library: a press held for `threshold` milliseconds
	fires `callback` and marks the press as a long press, so the matching release
	does not also trigger a click.
*/
const isTouchEvent = (event: ReactMouseEvent | ReactTouchEvent) =>
	window.TouchEvent ? event.nativeEvent instanceof TouchEvent : 'touches' in event.nativeEvent;

const isMouseEvent = (event: ReactMouseEvent | ReactTouchEvent) =>
	event.nativeEvent instanceof MouseEvent;

export const useLongPress = (
	onLongPress: (event: ReactMouseEvent | ReactTouchEvent) => void,
	options: LongPressOptions = {}
): LongPressHandlers => {
	const { threshold = 400, onStart, onFinish, onCancel } = options;
	const isLongPressActive = useRef(false);
	const isPressed = useRef(false);
	const timerId = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	return useMemo(() => {
		const start = (event: ReactMouseEvent | ReactTouchEvent) => {
			if (!isMouseEvent(event) && !isTouchEvent(event)) return;

			onStart?.(event);

			isPressed.current = true;
			timerId.current = setTimeout(() => {
				onLongPress(event);
				isLongPressActive.current = true;
			}, threshold);
		};

		const cancel = (event: ReactMouseEvent | ReactTouchEvent) => {
			if (!isMouseEvent(event) && !isTouchEvent(event)) return;

			if (isLongPressActive.current) {
				onFinish?.(event);
			} else if (isPressed.current) {
				onCancel?.(event);
			}

			isLongPressActive.current = false;
			isPressed.current = false;

			if (timerId.current) window.clearTimeout(timerId.current);
		};

		return {
			onMouseDown: start,
			onMouseUp: cancel,
			onMouseLeave: cancel,
			onTouchStart: start,
			onTouchEnd: cancel
		};
	}, [onLongPress, threshold, onCancel, onFinish, onStart]);
};
