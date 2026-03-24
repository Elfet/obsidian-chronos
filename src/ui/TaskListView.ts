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
	getDisplayText(): string { return "Chronos tasks"; }
	getIcon(): string { return "list-checks"; }

	onOpen(): Promise<void> {
		this.unsubscribe = this.store.subscribe(() => this.render());
		this.render();
		return Promise.resolve();
	}

	onClose(): Promise<void> {
		this.unsubscribe?.();
		return Promise.resolve();
	}

	private render(): void {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("chronos-task-list-view");

		const toolbar = container.createEl("div", { cls: "chronos-toolbar" });

		const addBtn = toolbar.createEl("button", {
			text: "+ new task",
			cls: "chronos-btn chronos-btn-primary",
		});
		addBtn.addEventListener("click", () => this.openNewTaskModal());

		toolbar.createEl("div", { cls: "chronos-toolbar-spacer" });

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

		const allTasks = this.store.getAllTasks();
		const filteredTree = this.store.getTaskTree().filter(({ task }) => this.visibleStatuses.has(task.status));
		filterGroup.createEl("span", {
			text: `${filteredTree.length}/${allTasks.length}`,
			cls: "chronos-task-count",
		});

		if (filteredTree.length === 0) {
			const empty = container.createEl("div", { cls: "chronos-empty-state" });
			if (allTasks.length === 0) {
				empty.createEl("div", { text: "No tasks yet", cls: "chronos-empty-title" });
				empty.createEl("div", { text: "Click \"+ new task\" to create your first epic, story, or task.", cls: "chronos-empty-desc" });
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

		row.draggable = true;
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

		row.createEl("span", { cls: "chronos-drag-handle", text: "⠿" });

		const badge = row.createEl("span", {
			text: TASK_TYPE_LABELS[task.type],
			cls: `chronos-badge chronos-badge-${task.type}`,
		});
		badge.style.backgroundColor = TASK_COLORS[task.type];

		row.createEl("span", { text: task.title, cls: "chronos-task-title" });

		row.createEl("span", {
			text: STATUS_LABELS[task.status],
			cls: `chronos-status chronos-status-${task.status}`,
		});

		if (task.startDate && task.endDate) {
			row.createEl("span", {
				text: `${task.startDate} → ${task.endDate}`,
				cls: "chronos-task-dates",
			});
		}

		const progressContainer = row.createEl("span", { cls: "chronos-progress-mini" });
		const progressBar = progressContainer.createEl("span", { cls: "chronos-progress-mini-bar" });
		progressBar.style.width = `${task.progress}%`;
		progressBar.style.backgroundColor = TASK_COLORS[task.type];
		progressContainer.createEl("span", {
			text: `${task.progress}%`,
			cls: "chronos-progress-mini-text",
		});

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

		row.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			this.showContextMenu(e, task);
		});

		row.addEventListener("dragover", (e) => {
			e.preventDefault();
			row.addClass("chronos-drop-target");
		});
		row.addEventListener("dragleave", () => {
			row.removeClass("chronos-drop-target");
		});
		row.addEventListener("drop", (e) => {
			e.preventDefault();
			row.removeClass("chronos-drop-target");
			const draggedId = e.dataTransfer?.getData("text/plain");
			if (draggedId && draggedId !== task.id) {
				const dragged = this.store.getTask(draggedId);
				if (dragged) {
					void (async () => {
						await this.store.updateTask(draggedId, { parentId: task.parentId });
						await this.store.reorderTask(draggedId, task.order + 1);
					})();
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
		menu.addItem((item) => item.setTitle("Delete").setIcon("trash").onClick(() => { void this.store.deleteTask(task.id); }));
		menu.showAtMouseEvent(e);
	}

	private openNewTaskModal(parentId?: string): void {
		new TaskModal(this.app, this.store, { defaultParentId: parentId, onSaved: () => this.render() }).open();
	}

	private openEditTaskModal(task: ChronosTask): void {
		new TaskModal(this.app, this.store, { editingTask: task, onSaved: () => this.render() }).open();
	}
}
