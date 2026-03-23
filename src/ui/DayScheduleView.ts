import { ItemView, WorkspaceLeaf, Menu } from "obsidian";
import { ChronosStore } from "../store";
import { ChronosTask, TASK_COLORS, TASK_TYPE_LABELS, ScheduleEntry } from "../types";
import { ScheduleBlockMenu, ScheduleQuickAddModal } from "./ScheduleBlockMenu";

export const DAY_SCHEDULE_VIEW_TYPE = "chronos-day-schedule";

const HOUR_HEIGHT = 60;
const START_HOUR = 0;
const END_HOUR = 24;
const TIME_LABEL_WIDTH = 56;
const SNAP_MINUTES = 15;

type ViewMode = "day" | "week";

export class DayScheduleView extends ItemView {
	private store: ChronosStore;
	private unsubscribe: (() => void) | null = null;
	private currentDate: string;
	private viewMode: ViewMode = "week";

	// References
	private gridWrapperEl: HTMLElement | null = null;
	private columnEls: Map<string, HTMLElement> = new Map();

	// Block drag state
	private blockDrag: {
		taskId: string;
		date: string;
		origStartTime: string;
		origEndTime: string;
		mode: "move" | "resize-bottom";
		anchorGridY: number;
		origStartMinutes: number;
		origEndMinutes: number;
		isOutside: boolean;
		currentDate: string; // track which column we're over
		hasMoved: boolean;   // distinguish click vs drag
	} | null = null;

	// Scroll position preservation
	private savedScrollTop: number | null = null;
	private autoScrollTimer: number | null = null;
	// Timestamp of last drag end — suppress clicks for a window after drag
	private dragEndTime = 0;

	constructor(leaf: WorkspaceLeaf, store: ChronosStore) {
		super(leaf);
		this.store = store;
		this.currentDate = getMondayOf(formatDateStr(new Date()));
	}

	getViewType(): string { return DAY_SCHEDULE_VIEW_TYPE; }
	getDisplayText(): string { return "Chronos Schedule"; }
	getIcon(): string { return "calendar-clock"; }

	async onOpen(): Promise<void> {
		this.unsubscribe = this.store.subscribe(() => {
			this.saveScroll();
			this.render();
		});
		this.render();
	}

	async onClose(): Promise<void> {
		this.unsubscribe?.();
		this.stopAutoScroll();
	}

	private saveScroll(): void {
		if (this.gridWrapperEl) {
			this.savedScrollTop = this.gridWrapperEl.scrollTop;
		}
	}

	private restoreScroll(): void {
		if (this.gridWrapperEl && this.savedScrollTop !== null) {
			this.gridWrapperEl.scrollTop = this.savedScrollTop;
			this.savedScrollTop = null;
		}
	}

	/** Auto-scroll the grid when cursor is near top/bottom edge during drag */
	private handleAutoScroll(clientY: number): void {
		if (!this.gridWrapperEl) return;
		const rect = this.gridWrapperEl.getBoundingClientRect();
		const edgeZone = 40; // px from edge to trigger scroll
		const scrollSpeed = 8; // px per frame

		const distFromTop = clientY - rect.top;
		const distFromBottom = rect.bottom - clientY;

		if (distFromTop < edgeZone && distFromTop > 0) {
			this.startAutoScroll(-scrollSpeed * (1 - distFromTop / edgeZone));
		} else if (distFromBottom < edgeZone && distFromBottom > 0) {
			this.startAutoScroll(scrollSpeed * (1 - distFromBottom / edgeZone));
		} else {
			this.stopAutoScroll();
		}
	}

	private startAutoScroll(speed: number): void {
		if (this.autoScrollTimer !== null) return;
		this.autoScrollTimer = window.setInterval(() => {
			if (this.gridWrapperEl) {
				this.gridWrapperEl.scrollTop += speed;
			}
		}, 16); // ~60fps
	}

	private stopAutoScroll(): void {
		if (this.autoScrollTimer !== null) {
			clearInterval(this.autoScrollTimer);
			this.autoScrollTimer = null;
		}
	}

	// ========== Coordinates ==========

	private clientYToGridY(clientY: number): number {
		if (!this.gridWrapperEl) return 0;
		const rect = this.gridWrapperEl.getBoundingClientRect();
		return clientY - rect.top + this.gridWrapperEl.scrollTop;
	}

	private gridYToMinutes(gridY: number): number {
		const raw = (gridY / HOUR_HEIGHT) * 60 + START_HOUR * 60;
		return snapMinutes(raw);
	}

	private minutesToGridY(minutes: number): number {
		return ((minutes - START_HOUR * 60) / 60) * HOUR_HEIGHT;
	}

	private isInsideGrid(clientX: number, clientY: number): boolean {
		if (!this.gridWrapperEl) return false;
		const rect = this.gridWrapperEl.getBoundingClientRect();
		return (
			clientX >= rect.left && clientX <= rect.right &&
			clientY >= rect.top && clientY <= rect.bottom
		);
	}

	/** Detect which date column the cursor is over */
	private getDateAtClientX(clientX: number): string | null {
		for (const [dateStr, colEl] of this.columnEls) {
			const rect = colEl.getBoundingClientRect();
			if (clientX >= rect.left && clientX <= rect.right) {
				return dateStr;
			}
		}
		return null;
	}

	// ========== Date helpers ==========

	private getVisibleDates(): string[] {
		if (this.viewMode === "day") return [this.currentDate];
		const dates: string[] = [];
		for (let i = 0; i < 7; i++) dates.push(shiftDate(this.currentDate, i));
		return dates;
	}

	private navigatePrev(): void {
		this.currentDate = shiftDate(this.currentDate, this.viewMode === "day" ? -1 : -7);
		this.render();
	}

	private navigateNext(): void {
		this.currentDate = shiftDate(this.currentDate, this.viewMode === "day" ? 1 : 7);
		this.render();
	}

	private goToday(): void {
		const today = formatDateStr(new Date());
		this.currentDate = this.viewMode === "week" ? getMondayOf(today) : today;
		this.render();
	}

	// ========== Render ==========

	private render(): void {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("chronos-schedule-view");
		this.columnEls.clear();

		this.renderToolbar(container);

		const dates = this.getVisibleDates();
		const gridHeight = (END_HOUR - START_HOUR) * HOUR_HEIGHT;
		const body = container.createEl("div", { cls: "chronos-schedule-body" });

		// --- Header row ---
		const headerRow = body.createEl("div", { cls: "chronos-schedule-header-row" });
		const corner = headerRow.createEl("div", { cls: "chronos-schedule-corner" });
		corner.style.width = `${TIME_LABEL_WIDTH}px`;
		corner.style.minWidth = `${TIME_LABEL_WIDTH}px`;

		const headerColumns = headerRow.createEl("div", { cls: "chronos-schedule-header-columns" });
		for (const dateStr of dates) {
			const header = headerColumns.createEl("div", { cls: "chronos-schedule-col-header" });
			const d = parseLocalDate(dateStr);
			const weekday = d.toLocaleDateString("en-US", { weekday: "short" });
			const dayNum = d.getDate();
			const isToday = dateStr === formatDateStr(new Date());
			header.createEl("span", { text: weekday, cls: "chronos-schedule-col-weekday" });
			header.createEl("span", {
				text: String(dayNum),
				cls: `chronos-schedule-col-day ${isToday ? "chronos-schedule-today" : ""}`,
			});
		}

		// --- Scroll area ---
		const scrollArea = body.createEl("div", { cls: "chronos-schedule-scroll-area" });
		this.gridWrapperEl = scrollArea;

		scrollArea.addEventListener("scroll", () => {
			headerColumns.style.transform = `translateX(-${scrollArea.scrollLeft}px)`;
		});

		const inner = scrollArea.createEl("div", { cls: "chronos-schedule-inner" });
		inner.style.height = `${gridHeight}px`;

		// Time column
		const timeCol = inner.createEl("div", { cls: "chronos-schedule-time-col" });
		timeCol.style.width = `${TIME_LABEL_WIDTH}px`;
		timeCol.style.minWidth = `${TIME_LABEL_WIDTH}px`;
		for (let h = START_HOUR; h < END_HOUR; h++) {
			const label = timeCol.createEl("div", { cls: "chronos-schedule-time-label" });
			label.style.top = `${(h - START_HOUR) * HOUR_HEIGHT}px`;
			const ampm = h < 12 ? "AM" : "PM";
			const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
			label.textContent = `${displayHour}:00 ${ampm}`;
		}

		// Day columns
		const columnsContainer = inner.createEl("div", { cls: "chronos-schedule-columns" });
		for (const dateStr of dates) {
			const col = columnsContainer.createEl("div", { cls: "chronos-schedule-col" });
			col.style.height = `${gridHeight}px`;
			this.columnEls.set(dateStr, col);

			// Hour lines
			for (let h = START_HOUR; h < END_HOUR; h++) {
				const hourLine = col.createEl("div", { cls: "chronos-schedule-hour-line" });
				hourLine.style.top = `${(h - START_HOUR) * HOUR_HEIGHT}px`;
				const halfLine = col.createEl("div", { cls: "chronos-schedule-half-line" });
				halfLine.style.top = `${(h - START_HOUR) * HOUR_HEIGHT + HOUR_HEIGHT / 2}px`;
			}

			// Click to add (suppress if drag just ended)
			col.addEventListener("click", (e) => {
				if (this.blockDrag) return;
				if (Date.now() - this.dragEndTime < 300) return;
				if ((e.target as HTMLElement).closest(".chronos-schedule-block")) return;
				const gridY = this.clientYToGridY(e.clientY);
				const minutes = this.gridYToMinutes(gridY);
				const endMinutes = clampMinutes(minutes + 60);
				new ScheduleQuickAddModal(
					this.app,
					this.store,
					dateStr,
					minutesToTime(minutes),
					minutesToTime(endMinutes),
					() => this.render(),
				).open();
			});

			// External D&D
			this.setupColumnDragDrop(col, dateStr);

			// Blocks
			const entries = this.store.getScheduleForDate(dateStr);
			for (const { task, entry } of entries) {
				this.renderScheduleBlock(col, task, entry);
			}

			// Now line
			if (dateStr === formatDateStr(new Date())) {
				const now = new Date();
				const nowY = this.minutesToGridY(now.getHours() * 60 + now.getMinutes());
				const nowLine = col.createEl("div", { cls: "chronos-schedule-now-line" });
				nowLine.style.top = `${nowY}px`;
			}
		}

		// Restore scroll position if saved (e.g. during drag re-render)
		this.restoreScroll();
	}

	// ========== Toolbar ==========

	private renderToolbar(container: HTMLElement): void {
		const toolbar = container.createEl("div", { cls: "chronos-toolbar chronos-schedule-toolbar" });

		// Slide toggle
		const toggle = toolbar.createEl("div", { cls: "chronos-slide-toggle" });
		const toggleTrack = toggle.createEl("div", { cls: "chronos-slide-toggle-track" });

		const dayLabel = toggleTrack.createEl("span", {
			text: "Day",
			cls: `chronos-slide-toggle-label ${this.viewMode === "day" ? "chronos-slide-toggle-label-active" : ""}`,
		});
		const weekLabel = toggleTrack.createEl("span", {
			text: "Week",
			cls: `chronos-slide-toggle-label ${this.viewMode === "week" ? "chronos-slide-toggle-label-active" : ""}`,
		});

		const thumb = toggleTrack.createEl("div", { cls: "chronos-slide-toggle-thumb" });
		if (this.viewMode === "week") {
			thumb.addClass("chronos-slide-toggle-thumb-right");
		}

		dayLabel.addEventListener("click", () => {
			if (this.viewMode === "day") return;
			this.viewMode = "day";
			this.render();
		});
		weekLabel.addEventListener("click", () => {
			if (this.viewMode === "week") return;
			this.viewMode = "week";
			this.currentDate = getMondayOf(this.currentDate);
			this.render();
		});

		toolbar.createEl("div", { cls: "chronos-toolbar-spacer" });

		// Navigation
		const prevBtn = toolbar.createEl("button", { text: "‹", cls: "chronos-btn" });
		prevBtn.addEventListener("click", () => this.navigatePrev());

		toolbar.createEl("span", { text: this.getDateRangeLabel(), cls: "chronos-schedule-date-label" });

		const nextBtn = toolbar.createEl("button", { text: "›", cls: "chronos-btn" });
		nextBtn.addEventListener("click", () => this.navigateNext());

		const todayBtn = toolbar.createEl("button", { text: "Today", cls: "chronos-btn" });
		todayBtn.addEventListener("click", () => this.goToday());
	}

	private getDateRangeLabel(): string {
		if (this.viewMode === "day") {
			const d = parseLocalDate(this.currentDate);
			return `${this.currentDate} (${d.toLocaleDateString("en-US", { weekday: "short" })})`;
		}
		const endDate = shiftDate(this.currentDate, 6);
		const s = parseLocalDate(this.currentDate);
		const e = parseLocalDate(endDate);
		return `${this.currentDate.slice(0, 4)} ${s.getMonth() + 1}/${s.getDate()} - ${e.getMonth() + 1}/${e.getDate()}`;
	}

	// ========== External D&D ==========

	private setupColumnDragDrop(colBody: HTMLElement, dateStr: string): void {
		const placeholder = colBody.createEl("div", { cls: "chronos-schedule-placeholder" });
		placeholder.style.display = "none";

		colBody.addEventListener("dragover", (e) => {
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
			const gridY = this.clientYToGridY(e.clientY);
			const minutes = this.gridYToMinutes(gridY);
			const snappedY = this.minutesToGridY(minutes);
			placeholder.style.display = "block";
			placeholder.style.top = `${snappedY}px`;
			placeholder.style.height = `${HOUR_HEIGHT}px`;
			const endMinutes = Math.min(minutes + 60, END_HOUR * 60);
			placeholder.textContent = `${minutesToTime(minutes)} - ${minutesToTime(endMinutes)}`;
		});

		colBody.addEventListener("dragleave", (e) => {
			const related = e.relatedTarget as HTMLElement | null;
			if (!related || !colBody.contains(related)) placeholder.style.display = "none";
		});

		colBody.addEventListener("drop", async (e) => {
			e.preventDefault();
			placeholder.style.display = "none";
			const taskId = e.dataTransfer?.getData("text/plain");
			if (!taskId || !this.store.getTask(taskId)) return;
			const gridY = this.clientYToGridY(e.clientY);
			const startMinutes = this.gridYToMinutes(gridY);
			const endMinutes = clampMinutes(startMinutes + 60);
			await this.store.addScheduleEntry(taskId, {
				date: dateStr,
				startTime: minutesToTime(startMinutes),
				endTime: minutesToTime(endMinutes),
			});
		});
	}

	// ========== Block rendering ==========

	private renderScheduleBlock(colBody: HTMLElement, task: ChronosTask, entry: ScheduleEntry): void {
		const startMinutes = parseTimeToMinutes(entry.startTime);
		const endMinutes = parseTimeToMinutes(entry.endTime);
		const durationMinutes = endMinutes - startMinutes;

		const top = this.minutesToGridY(startMinutes);
		const height = Math.max((durationMinutes / 60) * HOUR_HEIGHT, 20);
		const color = task.color ?? TASK_COLORS[task.type];

		const block = colBody.createEl("div", { cls: "chronos-schedule-block" });
		block.style.top = `${top}px`;
		block.style.height = `${height}px`;
		block.style.backgroundColor = color;
		block.style.borderLeft = `3px solid ${color}`;

		block.createEl("div", { cls: "chronos-schedule-block-title", text: task.title });
		block.createEl("div", { cls: "chronos-schedule-block-time", text: `${entry.startTime} - ${entry.endTime}` });
		block.createEl("span", { cls: "chronos-schedule-block-badge", text: TASK_TYPE_LABELS[task.type] });

		// Drag to move
		block.addEventListener("mousedown", (e: MouseEvent) => {
			if ((e.target as HTMLElement).classList.contains("chronos-schedule-resize-handle")) return;
			e.preventDefault();
			e.stopPropagation();
			this.startBlockDrag(e, task, entry, "move");
		});

		// Resize handle
		const resizeHandle = block.createEl("div", { cls: "chronos-schedule-resize-handle" });
		resizeHandle.addEventListener("mousedown", (e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			this.startBlockDrag(e, task, entry, "resize-bottom");
		});

		// Context menu
		block.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			const menu = new Menu();
			menu.addItem((item) =>
				item.setTitle("Edit").setIcon("pencil").onClick(() => {
					new ScheduleBlockMenu(this.app, this.store, task, entry, () => this.render()).open();
				})
			);
			menu.addItem((item) =>
				item.setTitle("Remove from schedule").setIcon("trash").onClick(async () => {
					await this.store.removeScheduleEntry(task.id, entry.date, entry.startTime);
				})
			);
			menu.showAtMouseEvent(e);
		});
	}

	// ========== Block drag (move / resize / cross-day / delete) ==========

	private startBlockDrag(
		e: MouseEvent,
		task: ChronosTask,
		entry: ScheduleEntry,
		mode: "move" | "resize-bottom"
	): void {
		const startMinutes = parseTimeToMinutes(entry.startTime);
		const endMinutes = parseTimeToMinutes(entry.endTime);

		this.blockDrag = {
			taskId: task.id,
			date: entry.date,
			origStartTime: entry.startTime,
			origEndTime: entry.endTime,
			mode,
			anchorGridY: this.clientYToGridY(e.clientY),
			origStartMinutes: startMinutes,
			origEndMinutes: endMinutes,
			isOutside: false,
			currentDate: entry.date,
			hasMoved: false,
		};

		let lastSavedStart = entry.startTime;
		let lastSavedEnd = entry.endTime;
		let lastSavedDate = entry.date;
		let deleteOverlay: HTMLElement | null = null;

		const onMouseMove = (ev: MouseEvent) => {
			if (!this.blockDrag) return;
			this.blockDrag.hasMoved = true;

			const inside = this.isInsideGrid(ev.clientX, ev.clientY);
			this.blockDrag.isOutside = !inside;

			// Auto-scroll when near edges
			this.handleAutoScroll(ev.clientY);

			// Outside → show delete indicator
			if (!inside && mode === "move") {
				if (!deleteOverlay) {
					deleteOverlay = document.body.createEl("div", { cls: "chronos-delete-overlay" });
					deleteOverlay.textContent = "Drop to remove";
				}
				deleteOverlay.style.left = `${ev.clientX + 16}px`;
				deleteOverlay.style.top = `${ev.clientY + 16}px`;
				return;
			}
			if (deleteOverlay) {
				deleteOverlay.remove();
				deleteOverlay = null;
			}

			// Detect cross-day movement
			let targetDate = lastSavedDate;
			if (mode === "move") {
				const hoveredDate = this.getDateAtClientX(ev.clientX);
				if (hoveredDate) targetDate = hoveredDate;
			}

			const currentGridY = this.clientYToGridY(ev.clientY);
			const deltaY = currentGridY - this.blockDrag.anchorGridY;
			const deltaMinutes = Math.round((deltaY / HOUR_HEIGHT) * 60 / SNAP_MINUTES) * SNAP_MINUTES;

			let newStartTime: string;
			let newEndTime: string;

			if (mode === "move") {
				const newStart = clampMinutes(this.blockDrag.origStartMinutes + deltaMinutes);
				const duration = this.blockDrag.origEndMinutes - this.blockDrag.origStartMinutes;
				const newEnd = clampMinutes(newStart + duration);
				if (newEnd - newStart < duration) return;
				newStartTime = minutesToTime(newStart);
				newEndTime = minutesToTime(newEnd);
			} else {
				const newEnd = clampMinutes(this.blockDrag.origEndMinutes + deltaMinutes);
				if (newEnd <= this.blockDrag.origStartMinutes + SNAP_MINUTES) return;
				newStartTime = this.blockDrag.origStartTime;
				newEndTime = minutesToTime(newEnd);
			}

			if (newStartTime === lastSavedStart && newEndTime === lastSavedEnd && targetDate === lastSavedDate) return;

			// Cross-day: remove from old date, add to new date
			if (targetDate !== lastSavedDate) {
				this.store.removeScheduleEntry(
					this.blockDrag.taskId,
					lastSavedDate,
					lastSavedStart
				).then(() => {
					if (!this.blockDrag) return;
					return this.store.addScheduleEntry(this.blockDrag.taskId, {
						date: targetDate,
						startTime: newStartTime,
						endTime: newEndTime,
					});
				}).then(() => {
					if (!this.blockDrag) return;
					this.blockDrag.date = targetDate;
					this.blockDrag.origStartTime = newStartTime;
					this.blockDrag.origEndTime = newEndTime;
					this.blockDrag.origStartMinutes = parseTimeToMinutes(newStartTime);
					this.blockDrag.origEndMinutes = parseTimeToMinutes(newEndTime);
					this.blockDrag.anchorGridY = currentGridY;
					lastSavedStart = newStartTime;
					lastSavedEnd = newEndTime;
					lastSavedDate = targetDate;
				});
			} else {
				lastSavedStart = newStartTime;
				lastSavedEnd = newEndTime;
				this.store.updateScheduleEntry(
					this.blockDrag.taskId,
					this.blockDrag.date,
					this.blockDrag.origStartTime,
					{ startTime: newStartTime, endTime: newEndTime }
				).then(() => {
					if (!this.blockDrag) return;
					this.blockDrag.origStartTime = newStartTime;
					this.blockDrag.origEndTime = newEndTime;
					this.blockDrag.origStartMinutes = parseTimeToMinutes(newStartTime);
					this.blockDrag.origEndMinutes = parseTimeToMinutes(newEndTime);
					this.blockDrag.anchorGridY = currentGridY;
				});
			}
		};

		const onMouseUp = async () => {
			document.removeEventListener("mousemove", onMouseMove);
			document.removeEventListener("mouseup", onMouseUp);
			this.stopAutoScroll();

			if (deleteOverlay) {
				deleteOverlay.remove();
				deleteOverlay = null;
			}

			const drag = this.blockDrag;
			this.blockDrag = null;

			// Suppress click events that may fire right after mouseup
			this.dragEndTime = Date.now();

			if (!drag) return;

			// If didn't move → open edit modal (click behavior)
			if (!drag.hasMoved) {
				new ScheduleBlockMenu(this.app, this.store, task, entry, () => this.render()).open();
				return;
			}

			// If released outside → delete
			if (drag.isOutside && mode === "move") {
				await this.store.removeScheduleEntry(drag.taskId, drag.date, drag.origStartTime);
			}
		};

		document.addEventListener("mousemove", onMouseMove);
		document.addEventListener("mouseup", onMouseUp);
	}
}

// ========== Utilities ==========

function formatDateStr(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shiftDate(dateStr: string, days: number): string {
	const d = parseLocalDate(dateStr);
	d.setDate(d.getDate() + days);
	return formatDateStr(d);
}

function parseLocalDate(dateStr: string): Date {
	const [y, m, d] = dateStr.split("-").map(Number);
	return new Date(y, m - 1, d);
}

function getMondayOf(dateStr: string): string {
	const d = parseLocalDate(dateStr);
	const day = d.getDay();
	d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
	return formatDateStr(d);
}

function parseTimeToMinutes(time: string): number {
	const [h, m] = time.split(":").map(Number);
	return h * 60 + m;
}

function minutesToTime(minutes: number): string {
	return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function clampMinutes(m: number): number {
	return Math.max(0, Math.min(24 * 60, m));
}

function snapMinutes(m: number): number {
	return Math.round(m / SNAP_MINUTES) * SNAP_MINUTES;
}
