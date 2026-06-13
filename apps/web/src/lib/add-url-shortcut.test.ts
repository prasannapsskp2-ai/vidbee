// @vitest-environment jsdom

import {
	isAddUrlShortcutEvent,
	shouldIgnoreAddUrlShortcutTarget,
} from "@vidbee/ui/lib/use-add-url-shortcut";
import { describe, expect, it } from "vitest";

/**
 * Creates a keyboard event for shortcut tests.
 *
 * @param options Event overrides for the generated keyboard event.
 * @returns A keyboard event with sane defaults for shortcut assertions.
 */
const createShortcutEvent = (options: KeyboardEventInit = {}): KeyboardEvent =>
	new KeyboardEvent("keydown", {
		bubbles: true,
		cancelable: true,
		code: "KeyV",
		ctrlKey: true,
		key: "v",
		...options,
	});

describe("isAddUrlShortcutEvent", () => {
	it("matches Ctrl+V", () => {
		expect(isAddUrlShortcutEvent(createShortcutEvent())).toBe(true);
	});

	it("matches Cmd+V", () => {
		expect(
			isAddUrlShortcutEvent(
				createShortcutEvent({
					ctrlKey: false,
					metaKey: true,
				}),
			),
		).toBe(true);
	});

	it("rejects non-paste shortcuts", () => {
		expect(
			isAddUrlShortcutEvent(
				createShortcutEvent({
					code: "KeyC",
					key: "c",
				}),
			),
		).toBe(false);
	});
});

describe("shouldIgnoreAddUrlShortcutTarget", () => {
	it("ignores text inputs", () => {
		const input = document.createElement("input");
		expect(shouldIgnoreAddUrlShortcutTarget(input)).toBe(true);
	});

	it("ignores textareas", () => {
		const textarea = document.createElement("textarea");
		expect(shouldIgnoreAddUrlShortcutTarget(textarea)).toBe(true);
	});

	it("ignores contenteditable elements", () => {
		const editable = document.createElement("div");
		editable.setAttribute("contenteditable", "true");
		expect(shouldIgnoreAddUrlShortcutTarget(editable)).toBe(true);
	});

	it("allows non-editable elements", () => {
		const button = document.createElement("button");
		expect(shouldIgnoreAddUrlShortcutTarget(button)).toBe(false);
	});
});
