import { ItemView, WorkspaceLeaf, Menu } from "obsidian";
import { ChronosStore } from "../store";
import { ChronosTask, TASK_TYPE_LABELS, STATUS_LABELS, TASK_COLORS, TaskStatus } from "../types";
import { TaskModal } from "./TaskModal";

export const TASK_LIST_VIEW_TYPE = "chronos-task-list";

export class TaskListView extends ItemView {
	private store: ChronosStore;
	private unsubscribe: (() => void) | null = null;
	private visibleStatuses: Set<TaskStatus> = new Set(["todo", "in-progress", "done"]);

	constructor(leaf: WorkspaceLeaf, store: ChronosStore) {
		super(leaf);
		this.store = store;
	}

	getViewType(): string { return TASK_LIST_VIEW_TYPE; }
	getDisplayText(): string { return "Chronos Tasks"; }
	getIcon(): string { return "list-checks"; }

	async onOpen(): Promise<void> {
		this.unsubscribe = this.store.subscribe(() => this.render());
		this.render();
	}

	async onClose(): Promise<void> {
		this.unsubscribe?.();
	}

	private render(): void {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("chronos-task-list-view");

		// Toolbar
		const toolbar = container.createEl("div", { cls: "chronos-toolbar" });

		const addBtn = toolbar.createEl("button", {
			text: "+ New Task",
			cls: "chronos-btn chronos-btn-primary",
		});
		addBtn.addEventListener("click", () => this.openNewTaskModal());

		toolbar.createEl("div", { cls: "chronos-toolbar-spacer" });

		// Status filter
		const filterGroup = toolbar.createEl("div", { cls: "chronos-gantt-filter-group" });
		const statuses: TaskStatus[] = ["todo", "in-progress", "done"];
		for (const status of statuses) {
			const isActive = this.visibleStatuses.has(status);
			const btn = filterGroup.createEl("button", {
				text: STATUS_LABELS[status],
				cls: `chronos-gantt-filter-btn ${isActive ? "chronos-gantt-filter-active" : ""}`,
			});
			btn.addEventListener("click", () => {
				if (this.visibleStatuses.has(status)) {
					if (this.visibleStatuses.size > 1) this.visibleStatuses.delete(status);
				} else {
					this.visibleStatuses.add(status);
				}
				this.render();
			});
		}

		// Task count
		const allTasks = this.store.getAllTasks();
		const filteredTree = this.store.getTaskTree().filter(({ task }) => this.visibleStatuses.has(task.status));
		filterGroup.createEl("span", {
			text: `${filteredTree.length}/${allTasks.length}`,
			cls: "chronos-task-count",
		});

		// Task tree
		if (filteredTree.length === 0) {
			const empty = container.createEl("div", { cls: "chronos-empty-state" });
			if (allTasks.length === 0) {
				empty.createEl("div", { text: "No tasks yet", cls: "chronos-empty-title" });
				empty.createEl("div", { text: "Click \"+ New Task\" to create your first epic, story, or task.", cls: "chronos-empty-desc" });
			} else {
				empty.createEl("div", { text: "No tasks match the current filter.", cls: "chronos-empty-desc" });
			}
			return;
		}

		const listEl = container.createEl("div", { cls: "chronos-task-tree" });
		for (const { task, depth } of filteredTree) {
			this.renderTaskRow(listEl, task, depth);
		}
	}

	private renderTaskRow(parent: HTMLElement, task: ChronosTask, depth: number): void {
		const row = parent.createEl("div", {
			cls: `chronos-task-row chronos-task-type-${task.type}`,
		});
		row.style.paddingLeft = `${depth * 24 + 8}px`;

		// Make the whole row draggable
		row.draggable = true;
		row.addEventListener("dragstart", (e) => {
			e.dataTransfer?.setData("text/plain", task.id);
			if (e.dataTransfer) {
				e.dataTransfer.effectAllowed = "copyMove";
				// Transparent ghost so only the schedule placeholder is visible
				const ghost = document.createElement("div");
				ghost.style.cssText = "width:1px;height:1px;opacity:0;position:absolute;top:-9999px";
				document.body.appendChild(ghost);
				e.dataTransfer.setDragImage(ghost, 0, 0);
				setTimeout(() => ghost.remove(), 0);
			}
		});

		// Drag handle (visual indicator only now)
		row.createEl("span", { cls: "chronos-drag-handle", text: "⠿" });

		// Type badge
		const badge = row.createEl("span", {
			text: TASK_TYPE_LABELS[task.type],
			cls: `chronos-badge chronos-badge-${task.type}`,
		});
		badge.style.backgroundColor = TASK_COLORS[task.type];

		// Title
		row.createEl("span", { text: task.title, cls: "chronos-task-title" });

		// Status
		row.createEl("span", {
			text: STATUS_LABELS[task.status],
			cls: `chronos-status chronos-status-${task.status}`,
		});

		// Dates
		if (task.startDate && task.endDate) {
			row.createEl("span", {
				text: `${task.startDate} → ${task.endDate}`,
				cls: "chronos-task-dates",
			});
		}

		// Progress bar
		const progressContainer = row.createEl("span", { cls: "chronos-progress-mini" });
		const progressBar = progressContainer.createEl("span", { cls: "chronos-progress-mini-bar" });
		progressBar.style.width = `${task.progress}%`;
		progressBar.style.backgroundColor = TASK_COLORS[task.type];
		progressContainer.createEl("span", {
			text: `${task.progress}%`,
			cls: "chronos-progress-mini-text",
		});

		// Actions
		const actions = row.createEl("span", { cls: "chronos-task-actions" });

		if (task.type === "epic" || task.type === "story") {
			const addChildBtn = actions.createEl("button", {
				text: "+", cls: "chronos-btn-icon",
				attr: { "aria-label": "Add child task" },
			});
			addChildBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				this.openNewTaskModal(task.id);
			});
		}

		const editBtn = actions.createEl("button", {
			text: "✎", cls: "chronos-btn-icon",
			attr: { "aria-label": "Edit task" },
		});
		editBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this.openEditTaskModal(task);
		});

		// Context menu
		row.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			this.showContextMenu(e, task);
		});

		// Drop zone
		row.addEventListener("dragover", (e) => {
			e.preventDefault();
			row.addClass("chronos-drop-target");
		});
		row.addEventListener("dragleave", () => {
			row.removeClass("chronos-drop-target");
		});
		row.addEventListener("drop", async (e) => {
			e.preventDefault();
			row.removeClass("chronos-drop-target");
			const draggedId = e.dataTransfer?.getData("text/plain");
			if (draggedId && draggedId !== task.id) {
				const dragged = this.store.getTask(draggedId);
				if (dragged) {
					await this.store.updateTask(draggedId, { parentId: task.parentId });
					await this.store.reorderTask(draggedId, task.order + 1);
				}
			}
		});
	}

	private showContextMenu(e: MouseEvent, task: ChronosTask): void {
		const menu = new Menu();
		menu.addItem((item) => item.setTitle("Edit").setIcon("pencil").onClick(() => this.openEditTaskModal(task)));
		if (task.type === "epic" || task.type === "story") {
			menu.addItem((item) => item.setTitle("Add child").setIcon("plus").onClick(() => this.openNewTaskModal(task.id)));
		}
		menu.addSeparator();
		menu.addItem((item) => item.setTitle("Delete").setIcon("trash").onClick(async () => { await this.store.deleteTask(task.id); }));
		menu.showAtMouseEvent(e);
	}

	private openNewTaskModal(parentId?: string): void {
		new TaskModal(this.app, this.store, { defaultParentId: parentId, onSaved: () => this.render() }).open();
	}

	private openEditTaskModal(task: ChronosTask): void {
		new TaskModal(this.app, this.store, { editingTask: task, onSaved: () => this.render() }).open();
	}
}
