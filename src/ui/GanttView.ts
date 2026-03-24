import { ItemView, WorkspaceLeaf } from "obsidian";
import { ChronosStore } from "../store";
import { ChronosTask, TASK_COLORS, TASK_TYPE_LABELS, TaskStatus, STATUS_LABELS } from "../types";
import { TaskModal } from "./TaskModal";

export const GANTT_VIEW_TYPE = "chronos-gantt";

const DAY_MS = 86400000;
const ROW_HEIGHT = 36;
const BAR_HEIGHT = 22;
const HEADER_HEIGHT = 44;
const DEFAULT_LABEL_WIDTH = 220;
const MIN_LABEL_WIDTH = 100;
const MAX_LABEL_WIDTH = 500;
const PADDING_MONTHS = 2;

export class GanttView extends ItemView {
	private store: ChronosStore;
	private unsubscribe: (() => void) | null = null;
	private dayWidth = 28;
	private labelWidth = DEFAULT_LABEL_WIDTH;

	// Status filter: which statuses to show (all visible by default)
	private visibleStatuses: Set<TaskStatus> = new Set(["todo", "in-progress", "done"]);

	// Preserve scroll position across re-renders
	private savedScrollLeft: number | null = null;
	private savedScrollTop: number | null = null;
	private needsScrollToToday = true; // on first render, scroll to today

	// Gantt bar drag state
	private dragTask: ChronosTask | null = null;
	private dragMode: "move" | "resize-start" | "resize-end" | null = null;
	private dragStartX = 0;
	private dragOrigStart = "";
	private dragOrigEnd = "";
	private isDragging = false;

	// Chart area ref (for saving scroll)
	private chartAreaEl: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, store: ChronosStore) {
		super(leaf);
		this.store = store;
	}

	getViewType(): string { return GANTT_VIEW_TYPE; }
	getDisplayText(): string { return "Chronos gantt"; }
	getIcon(): string { return "gantt-chart"; }

	onOpen(): Promise<void> {
		this.unsubscribe = this.store.subscribe(() => {
			if (this.isDragging) return;
			this.saveScrollPosition();
			this.render();
		});
		this.needsScrollToToday = true;
		this.render();
		return Promise.resolve();
	}

	onClose(): Promise<void> {
		this.unsubscribe?.();
		return Promise.resolve();
	}

	private saveScrollPosition(): void {
		if (this.chartAreaEl) {
			this.savedScrollLeft = this.chartAreaEl.scrollLeft;
			this.savedScrollTop = this.chartAreaEl.scrollTop;
		}
	}

	private render(): void {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("chronos-gantt-view");

		// Apply status filter
		const allGanttTasks = this.store.getGanttTasks();
		const ganttTasks = allGanttTasks.filter(({ task }) => this.visibleStatuses.has(task.status));

		if (allGanttTasks.length === 0) {
			const empty = container.createEl("div", { cls: "chronos-empty-state" });
			empty.createEl("div", { text: "No tasks to display", cls: "chronos-empty-title" });
			empty.createEl("div", { text: "Add tasks with dates in the task list view.", cls: "chronos-empty-desc" });
			return;
		}

		// Toolbar
		this.renderToolbar(container);

		if (ganttTasks.length === 0) {
			container.createEl("div", { cls: "chronos-empty-state" }).createEl("div", {
				text: "No tasks match the current filter.",
				cls: "chronos-empty-desc",
			});
			return;
		}

		// Calculate date range
		const allTasks = ganttTasks.map((g) => g.task);
		const minDate = this.minDate(allTasks);
		const maxDate = this.maxDate(allTasks);
		const today = new Date();
		today.setHours(0, 0, 0, 0);

		// Include today in the range so the chart always covers the current month
		const rangeMin = minDate < today ? minDate : today;
		const rangeMax = maxDate > today ? maxDate : today;

		const startDate = new Date(rangeMin.getFullYear(), rangeMin.getMonth() - PADDING_MONTHS, 1);
		const endDate = new Date(rangeMax.getFullYear(), rangeMax.getMonth() + PADDING_MONTHS + 1, 0);

		const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / DAY_MS);
		const chartWidth = totalDays * this.dayWidth;

		// ===== Layout =====
		const body = container.createEl("div", { cls: "chronos-gantt-body" });

		// Label column
		const labelCol = body.createEl("div", { cls: "chronos-gantt-label-col" });
		labelCol.style.width = `${this.labelWidth}px`;

		const labelHeader = labelCol.createEl("div", { cls: "chronos-gantt-label-header" });
		labelHeader.style.height = `${HEADER_HEIGHT}px`;

		const labelRows = labelCol.createEl("div", { cls: "chronos-gantt-label-rows" });
		for (const { task, depth } of ganttTasks) {
			const row = labelRows.createEl("div", {
				cls: `chronos-gantt-label-row chronos-gantt-label-depth-${Math.min(depth, 2)}`,
				attr: { draggable: "true" },
			});
			row.style.height = `${ROW_HEIGHT}px`;
			row.style.paddingLeft = `${8 + depth * 16}px`;

			row.createEl("span", { cls: "chronos-gantt-label-drag", text: "⠿" });

			const color = task.color ?? TASK_COLORS[task.type];
			const badge = row.createEl("span", {
				text: TASK_TYPE_LABELS[task.type][0],
				cls: "chronos-gantt-type-dot",
			});
			badge.style.backgroundColor = color;

			row.createEl("span", { text: task.title, cls: "chronos-gantt-label-title" });

			row.addEventListener("dragstart", (e) => {
				e.dataTransfer?.setData("text/plain", task.id);
				if (e.dataTransfer) {
					e.dataTransfer.effectAllowed = "copyMove";
					const ghost = document.createElement("div");
					ghost.addClass("chronos-drag-ghost");
					document.body.appendChild(ghost);
					e.dataTransfer.setDragImage(ghost, 0, 0);
					setTimeout(() => ghost.remove(), 0);
				}
			});

			// Click to edit
			row.addEventListener("click", () => {
				this.saveScrollPosition();
				new TaskModal(this.app, this.store, {
					editingTask: task,
					onSaved: () => {},
				}).open();
			});
		}

		// Resize handle
		const resizeHandle = body.createEl("div", { cls: "chronos-gantt-resize-handle" });
		resizeHandle.addEventListener("mousedown", (e: MouseEvent) => {
			e.preventDefault();
			const startX = e.clientX;
			const startWidth = this.labelWidth;
			const onMove = (ev: MouseEvent) => {
				this.labelWidth = Math.max(MIN_LABEL_WIDTH, Math.min(MAX_LABEL_WIDTH, startWidth + ev.clientX - startX));
				labelCol.style.width = `${this.labelWidth}px`;
			};
			const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
			document.addEventListener("mousemove", onMove);
			document.addEventListener("mouseup", onUp);
		});

		// Chart area
		const chartArea = body.createEl("div", { cls: "chronos-gantt-chart-area" });
		this.chartAreaEl = chartArea;

		chartArea.addEventListener("scroll", () => {
			labelRows.scrollTop = chartArea.scrollTop;
		});

		// Chart header
		const chartHeader = chartArea.createEl("div", { cls: "chronos-gantt-chart-header" });
		chartHeader.style.width = `${chartWidth}px`;
		chartHeader.style.height = `${HEADER_HEIGHT}px`;
		this.renderChartHeader(chartHeader, startDate, endDate, totalDays, chartWidth);

		// Chart body
		const chartBody = chartArea.createEl("div", { cls: "chronos-gantt-chart-body" });
		chartBody.style.width = `${chartWidth}px`;

		this.renderGridHTML(chartBody, startDate, endDate, totalDays, chartWidth, ganttTasks.length);

		// Task bars
		ganttTasks.forEach(({ task }, index) => {
			const tStart = this.parseDate(task.startDate);
			const tEnd = this.parseDate(task.endDate);
			if (!tStart || !tEnd) return;

			const x1 = this.dateToPx(tStart, startDate, totalDays, chartWidth);
			const x2 = this.dateToPx(tEnd, startDate, totalDays, chartWidth);
			const barWidth = Math.max(x2 - x1, 4);
			const color = task.color ?? TASK_COLORS[task.type];
			const barTop = index * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2;

			const bar = chartBody.createEl("div", { cls: "chronos-gantt-bar" });
			bar.style.left = `${x1}px`;
			bar.style.top = `${barTop}px`;
			bar.style.width = `${barWidth}px`;
			bar.style.height = `${BAR_HEIGHT}px`;

			// Background
			const bgEl = bar.createEl("div", { cls: "chronos-gantt-bar-bg" });
			bgEl.style.backgroundColor = color;

			// Progress fill
			if (task.progress > 0) {
				const fill = bar.createEl("div", { cls: "chronos-gantt-bar-fill" });
				fill.style.width = `${task.progress}%`;
				fill.style.backgroundColor = color;
			}

			// Progress % inside bar (if wide enough)
			if (barWidth > 40) {
				bar.createEl("span", {
					text: `${task.progress}%`,
					cls: "chronos-gantt-bar-pct-inner",
				});
			}

			// Progress % outside bar (always, for narrow bars)
			bar.createEl("span", {
				text: `${task.progress}%`,
				cls: "chronos-gantt-bar-pct",
			});

			bar.title = `${task.title}\n${task.startDate} → ${task.endDate}\n${STATUS_LABELS[task.status]} · ${task.progress}%`;

			// Resize grips
			const leftGrip = bar.createEl("div", { cls: "chronos-gantt-grip chronos-gantt-grip-left" });
			this.addBarDrag(leftGrip, task, "resize-start", startDate, totalDays, chartWidth);

			const rightGrip = bar.createEl("div", { cls: "chronos-gantt-grip chronos-gantt-grip-right" });
			this.addBarDrag(rightGrip, task, "resize-end", startDate, totalDays, chartWidth);

			// Move drag + click-to-edit
			bar.addEventListener("mousedown", (e: MouseEvent) => {
				if ((e.target as HTMLElement).classList.contains("chronos-gantt-grip")) return;
				e.preventDefault();
				this.startBarDragWithClick(e, task, startDate, totalDays, chartWidth);
			});
		});

		this.renderDependencySVG(chartBody, ganttTasks, startDate, totalDays, chartWidth);

		// --- Scroll position ---
		if (this.needsScrollToToday) {
			// First render: scroll so today is visible (roughly centered)
			this.needsScrollToToday = false;
			const todayX = this.dateToPx(today, startDate, totalDays, chartWidth);
			const viewWidth = chartArea.clientWidth || 400;
			chartArea.scrollLeft = Math.max(0, todayX - viewWidth / 3);
		} else if (this.savedScrollLeft !== null) {
			chartArea.scrollLeft = this.savedScrollLeft;
			chartArea.scrollTop = this.savedScrollTop ?? 0;
			this.savedScrollLeft = null;
			this.savedScrollTop = null;
		}
	}

	// ===== Toolbar =====

	private renderToolbar(container: HTMLElement): void {
		const toolbar = container.createEl("div", { cls: "chronos-toolbar" });

		// Zoom
		const zoomOutBtn = toolbar.createEl("button", { text: "−", cls: "chronos-btn" });
		toolbar.createEl("span", { text: "Zoom", cls: "chronos-zoom-label" });
		const zoomInBtn = toolbar.createEl("button", { text: "+", cls: "chronos-btn" });
		zoomOutBtn.addEventListener("click", () => { this.saveScrollPosition(); this.dayWidth = Math.max(8, this.dayWidth - 4); this.render(); });
		zoomInBtn.addEventListener("click", () => { this.saveScrollPosition(); this.dayWidth = Math.min(80, this.dayWidth + 4); this.render(); });

		toolbar.createEl("div", { cls: "chronos-toolbar-spacer" });

		// Status filter
		const filterGroup = toolbar.createEl("div", { cls: "chronos-gantt-filter-group" });
		filterGroup.createEl("span", { text: "Filter:", cls: "chronos-gantt-filter-label" });

		const statuses: TaskStatus[] = ["todo", "in-progress", "done"];
		for (const status of statuses) {
			const isActive = this.visibleStatuses.has(status);
			const btn = filterGroup.createEl("button", {
				text: STATUS_LABELS[status],
				cls: `chronos-gantt-filter-btn ${isActive ? "chronos-gantt-filter-active" : ""}`,
			});
			btn.addEventListener("click", () => {
				this.saveScrollPosition();
				if (this.visibleStatuses.has(status)) {
					// Don't allow deselecting all
					if (this.visibleStatuses.size > 1) {
						this.visibleStatuses.delete(status);
					}
				} else {
					this.visibleStatuses.add(status);
				}
				this.render();
			});
		}

		// Today button
		const todayBtn = toolbar.createEl("button", { text: "Today", cls: "chronos-btn" });
		todayBtn.addEventListener("click", () => {
			this.needsScrollToToday = true;
			this.render();
		});
	}

	// ===== Chart header =====

	private renderChartHeader(
		header: HTMLElement, startDate: Date, endDate: Date,
		totalDays: number, chartWidth: number,
	): void {
		const monthRow = header.createEl("div", { cls: "chronos-gantt-month-row" });
		const current = new Date(startDate);
		let lastMonth = -1;
		let monthStartX = 0;

		while (current <= endDate) {
			if (current.getMonth() !== lastMonth) {
				if (lastMonth !== -1) {
					const prevLabel = monthRow.lastElementChild as HTMLElement;
					if (prevLabel) {
						const x = this.dateToPx(current, startDate, totalDays, chartWidth);
						prevLabel.style.width = `${x - monthStartX}px`;
					}
				}
				lastMonth = current.getMonth();
				monthStartX = this.dateToPx(current, startDate, totalDays, chartWidth);

				const label = monthRow.createEl("div", { cls: "chronos-gantt-month-label" });
				label.style.left = `${monthStartX}px`;
				label.textContent = current.toLocaleDateString("en", { month: "short", year: "numeric" });
			}
			current.setDate(current.getDate() + 1);
		}
		const lastLabel = monthRow.lastElementChild as HTMLElement;
		if (lastLabel) lastLabel.style.width = `${chartWidth - monthStartX}px`;

		if (this.dayWidth >= 18) {
			const dayRow = header.createEl("div", { cls: "chronos-gantt-day-row" });
			const cur = new Date(startDate);
			while (cur <= endDate) {
				const x = this.dateToPx(cur, startDate, totalDays, chartWidth);
				const dayLabel = dayRow.createEl("div", { cls: "chronos-gantt-day-label" });
				dayLabel.style.left = `${x}px`;
				dayLabel.style.width = `${this.dayWidth}px`;
				dayLabel.textContent = String(cur.getDate());
				const dow = cur.getDay();
				if (dow === 0 || dow === 6) dayLabel.addClass("chronos-gantt-weekend");
				cur.setDate(cur.getDate() + 1);
			}
		}
	}

	// ===== Grid =====

	private renderGridHTML(
		chartBody: HTMLElement, startDate: Date, endDate: Date,
		totalDays: number, chartWidth: number, taskCount: number,
	): void {
		for (let i = 0; i < taskCount; i++) {
			const stripe = chartBody.createEl("div", { cls: `chronos-gantt-row-stripe ${i % 2 === 1 ? "chronos-gantt-row-alt" : ""}` });
			stripe.style.top = `${i * ROW_HEIGHT}px`;
			stripe.style.height = `${ROW_HEIGHT}px`;
		}

		if (this.dayWidth >= 12) {
			const cur = new Date(startDate);
			while (cur <= endDate) {
				if (cur.getDay() === 0 || cur.getDay() === 6) {
					const x = this.dateToPx(cur, startDate, totalDays, chartWidth);
					const col = chartBody.createEl("div", { cls: "chronos-gantt-weekend-col" });
					col.style.left = `${x}px`;
					col.style.width = `${this.dayWidth}px`;
					col.style.height = `${taskCount * ROW_HEIGHT}px`;
				}
				cur.setDate(cur.getDate() + 1);
			}
		}

		const today = new Date();
		today.setHours(0, 0, 0, 0);
		if (today >= startDate && today <= endDate) {
			const tx = this.dateToPx(today, startDate, totalDays, chartWidth);
			const todayLine = chartBody.createEl("div", { cls: "chronos-gantt-today-line" });
			todayLine.style.left = `${tx}px`;
			todayLine.style.height = `${taskCount * ROW_HEIGHT}px`;
		}
	}

	// ===== Dependencies =====

	private renderDependencySVG(
		chartBody: HTMLElement,
		ganttTasks: { task: ChronosTask; depth: number }[],
		startDate: Date, totalDays: number, chartWidth: number,
	): void {
		const hasAnyDeps = ganttTasks.some(({ task }) => task.dependencies?.length);
		if (!hasAnyDeps) return;

		const svgHeight = ganttTasks.length * ROW_HEIGHT;
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.setAttribute("class", "chronos-gantt-dep-svg");
		svg.setAttribute("width", String(chartWidth));
		svg.setAttribute("height", String(svgHeight));
		chartBody.appendChild(svg);

		const indexMap = new Map<string, number>();
		ganttTasks.forEach(({ task }, i) => indexMap.set(task.id, i));

		for (const { task } of ganttTasks) {
			if (!task.dependencies?.length) continue;
			const toIdx = indexMap.get(task.id);
			if (toIdx === undefined) continue;
			for (const depId of task.dependencies) {
				const fromIdx = indexMap.get(depId);
				if (fromIdx === undefined) continue;
				const depTask = this.store.getTask(depId);
				if (!depTask) continue;
				const fromEnd = this.parseDate(depTask.endDate);
				const toStart = this.parseDate(task.startDate);
				if (!fromEnd || !toStart) continue;

				const fromX = this.dateToPx(fromEnd, startDate, totalDays, chartWidth);
				const toX = this.dateToPx(toStart, startDate, totalDays, chartWidth);
				const fromY = fromIdx * ROW_HEIGHT + ROW_HEIGHT / 2;
				const toY = toIdx * ROW_HEIGHT + ROW_HEIGHT / 2;
				const midX = (fromX + toX) / 2;

				svg.appendChild(this.svgEl("path", {
					d: `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`,
					class: "chronos-dep-line", fill: "none",
				}));
				svg.appendChild(this.svgEl("polygon", {
					points: `${toX},${toY} ${toX - 6},${toY - 4} ${toX - 6},${toY + 4}`,
					class: "chronos-dep-arrow",
				}));
			}
		}
	}

	// ===== Bar drag =====

	private addBarDrag(
		el: HTMLElement, task: ChronosTask,
		mode: "resize-start" | "resize-end",
		startDate: Date, totalDays: number, chartWidth: number,
	): void {
		el.addEventListener("mousedown", (e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			this.startBarDrag(e, task, mode, startDate, totalDays, chartWidth);
		});
	}

	/** Start drag for resize grips (no click-to-edit) */
	private startBarDrag(
		e: MouseEvent, task: ChronosTask,
		mode: "move" | "resize-start" | "resize-end",
		startDate: Date, totalDays: number, chartWidth: number,
	): void {
		this.dragTask = task;
		this.dragMode = mode;
		this.dragStartX = e.clientX;
		this.dragOrigStart = task.startDate;
		this.dragOrigEnd = task.endDate;
		this.isDragging = true;

		const onMouseMove = (ev: MouseEvent) => {
			if (!this.dragTask || !this.dragMode) return;
			const dx = ev.clientX - this.dragStartX;
			const daysDelta = Math.round(dx / this.dayWidth);
			if (daysDelta === 0) return;
			this.applyDrag(daysDelta);
		};

		const onMouseUp = () => {
			document.removeEventListener("mousemove", onMouseMove);
			document.removeEventListener("mouseup", onMouseUp);
			this.isDragging = false;

			if (this.dragTask) {
				if (this.dragTask.startDate !== this.dragOrigStart || this.dragTask.endDate !== this.dragOrigEnd) {
					this.saveScrollPosition();
					void this.store.updateTask(this.dragTask.id, {
						startDate: this.dragTask.startDate,
						endDate: this.dragTask.endDate,
					});
				}
			}
			this.dragTask = null;
			this.dragMode = null;
		};

		document.addEventListener("mousemove", onMouseMove);
		document.addEventListener("mouseup", onMouseUp);
	}

	private startBarDragWithClick(
		e: MouseEvent, task: ChronosTask,
		startDate: Date, totalDays: number, chartWidth: number,
	): void {
		this.dragTask = task;
		this.dragMode = "move";
		this.dragStartX = e.clientX;
		this.dragOrigStart = task.startDate;
		this.dragOrigEnd = task.endDate;
		this.isDragging = true;
		let hasMoved = false;

		const onMouseMove = (ev: MouseEvent) => {
			if (!this.dragTask || !this.dragMode) return;
			const dx = ev.clientX - this.dragStartX;
			const daysDelta = Math.round(dx / this.dayWidth);
			if (daysDelta === 0) return;
			hasMoved = true;
			this.applyDrag(daysDelta);
		};

		const onMouseUp = () => {
			document.removeEventListener("mousemove", onMouseMove);
			document.removeEventListener("mouseup", onMouseUp);
			this.isDragging = false;

			if (!hasMoved) {
				this.dragTask = null;
				this.dragMode = null;
				this.saveScrollPosition();
				new TaskModal(this.app, this.store, {
					editingTask: task,
					onSaved: () => {},
				}).open();
				return;
			}

			if (this.dragTask) {
				if (this.dragTask.startDate !== this.dragOrigStart || this.dragTask.endDate !== this.dragOrigEnd) {
					this.saveScrollPosition();
					void this.store.updateTask(this.dragTask.id, {
						startDate: this.dragTask.startDate,
						endDate: this.dragTask.endDate,
					});
				}
			}
			this.dragTask = null;
			this.dragMode = null;
		};

		document.addEventListener("mousemove", onMouseMove);
		document.addEventListener("mouseup", onMouseUp);
	}

	private applyDrag(daysDelta: number): void {
		if (!this.dragTask) return;
		const origStart = this.parseDate(this.dragOrigStart)!;
		const origEnd = this.parseDate(this.dragOrigEnd)!;

		if (this.dragMode === "move") {
			this.dragTask.startDate = this.formatDate(new Date(origStart.getTime() + daysDelta * DAY_MS));
			this.dragTask.endDate = this.formatDate(new Date(origEnd.getTime() + daysDelta * DAY_MS));
		} else if (this.dragMode === "resize-start") {
			const newStart = new Date(origStart.getTime() + daysDelta * DAY_MS);
			if (newStart < this.parseDate(this.dragOrigEnd)!) this.dragTask.startDate = this.formatDate(newStart);
		} else if (this.dragMode === "resize-end") {
			const newEnd = new Date(origEnd.getTime() + daysDelta * DAY_MS);
			if (newEnd > this.parseDate(this.dragOrigStart)!) this.dragTask.endDate = this.formatDate(newEnd);
		}
		this.saveScrollPosition();
		this.render();
	}

	// ===== Utilities =====

	private dateToPx(date: Date, startDate: Date, totalDays: number, chartWidth: number): number {
		return ((date.getTime() - startDate.getTime()) / DAY_MS / totalDays) * chartWidth;
	}

	private minDate(tasks: ChronosTask[]): Date {
		let min = this.parseDate(tasks[0].startDate)!;
		for (const t of tasks) { const d = this.parseDate(t.startDate); if (d && d < min) min = d; }
		return min;
	}

	private maxDate(tasks: ChronosTask[]): Date {
		let max = this.parseDate(tasks[0].endDate)!;
		for (const t of tasks) { const d = this.parseDate(t.endDate); if (d && d > max) max = d; }
		return max;
	}

	private parseDate(str: string): Date | null {
		const m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
		if (!m) return null;
		return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
	}

	private formatDate(d: Date): string {
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
	}

	private svgEl(tag: string, attrs: Record<string, string>): SVGElement {
		const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
		for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
		return el;
	}
}
