import { App, Modal, Setting } from "obsidian";
import { ChronosStore } from "../store";
import { ChronosTask, ScheduleEntry, TASK_TYPE_LABELS, TASK_COLORS } from "../types";

export class ScheduleBlockMenu extends Modal {
	private store: ChronosStore;
	private origTask: ChronosTask;
	private origEntry: ScheduleEntry;
	private onChanged: () => void;

	private selectedTaskId: string;
	private formDate: string;
	private formStartTime: string;
	private formEndTime: string;

	constructor(
		app: App,
		store: ChronosStore,
		task: ChronosTask,
		entry: ScheduleEntry,
		onChanged: () => void,
	) {
		super(app);
		this.store = store;
		this.origTask = task;
		this.origEntry = entry;
		this.onChanged = onChanged;

		this.selectedTaskId = task.id;
		this.formDate = entry.date;
		this.formStartTime = entry.startTime;
		this.formEndTime = entry.endTime;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("chronos-modal");

		contentEl.createEl("h2", { text: "Schedule block" });

		const taskInfo = contentEl.createEl("div", { cls: "chronos-block-menu-task" });
		const badge = taskInfo.createEl("span", {
			text: TASK_TYPE_LABELS[this.origTask.type],
			cls: "chronos-badge",
		});
		badge.style.backgroundColor = TASK_COLORS[this.origTask.type];
		taskInfo.createEl("span", {
			text: this.origTask.title,
			cls: "chronos-block-menu-task-title",
		});

		const allTasks = this.store.getAllTasks();
		new Setting(contentEl).setName("Task").addDropdown((dd) => {
			for (const t of allTasks) {
				const prefix = TASK_TYPE_LABELS[t.type];
				dd.addOption(t.id, `[${prefix}] ${t.title}`);
			}
			dd.setValue(this.selectedTaskId);
			dd.onChange((newTaskId) => {
				this.selectedTaskId = newTaskId;
			});
		});

		new Setting(contentEl).setName("Date").addText((text) => {
			text.inputEl.type = "date";
			text.setValue(this.formDate);
			text.onChange((v) => { this.formDate = v; });
		});

		new Setting(contentEl).setName("Start time").addText((text) => {
			text.inputEl.type = "time";
			text.setValue(this.formStartTime);
			text.onChange((v) => { this.formStartTime = v; });
		});

		new Setting(contentEl).setName("End time").addText((text) => {
			text.inputEl.type = "time";
			text.setValue(this.formEndTime);
			text.onChange((v) => { this.formEndTime = v; });
		});

		const btnContainer = contentEl.createEl("div", { cls: "chronos-modal-buttons" });

		const deleteBtn = btnContainer.createEl("button", {
			text: "Remove",
			cls: "chronos-btn-danger",
		});
		deleteBtn.addEventListener("click", () => {
			void (async () => {
				await this.store.removeScheduleEntry(
					this.origTask.id,
					this.origEntry.date,
					this.origEntry.startTime,
				);
				this.onChanged();
				this.close();
			})();
		});

		btnContainer.createEl("div", { cls: "chronos-toolbar-spacer" });

		const cancelBtn = btnContainer.createEl("button", {
			text: "Cancel",
			cls: "chronos-btn",
		});
		cancelBtn.addEventListener("click", () => this.close());

		const saveBtn = btnContainer.createEl("button", {
			text: "Save",
			cls: "mod-cta",
		});
		saveBtn.addEventListener("click", () => { void this.handleSave(); });
	}

	private async handleSave(): Promise<void> {
		const taskChanged = this.selectedTaskId !== this.origTask.id;
		const dateChanged = this.formDate !== this.origEntry.date;
		const timeChanged =
			this.formStartTime !== this.origEntry.startTime ||
			this.formEndTime !== this.origEntry.endTime;

		if (taskChanged || dateChanged) {
			await this.store.removeScheduleEntry(
				this.origTask.id,
				this.origEntry.date,
				this.origEntry.startTime,
			);
			await this.store.addScheduleEntry(this.selectedTaskId, {
				date: this.formDate,
				startTime: this.formStartTime,
				endTime: this.formEndTime,
			});
		} else if (timeChanged) {
			await this.store.updateScheduleEntry(
				this.origTask.id,
				this.origEntry.date,
				this.origEntry.startTime,
				{ startTime: this.formStartTime, endTime: this.formEndTime },
			);
		} else {
			this.close();
			return;
		}

		this.onChanged();
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class ScheduleQuickAddModal extends Modal {
	private store: ChronosStore;
	private date: string;
	private startTime: string;
	private endTime: string;
	private onChanged: () => void;

	constructor(
		app: App,
		store: ChronosStore,
		date: string,
		startTime: string,
		endTime: string,
		onChanged: () => void,
	) {
		super(app);
		this.store = store;
		this.date = date;
		this.startTime = startTime;
		this.endTime = endTime;
		this.onChanged = onChanged;
	}

	onOpen(): void {
		this.renderContent();
	}

	private renderContent(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("chronos-modal", "chronos-quick-add-modal");

		contentEl.createEl("h2", {
			text: "Add to schedule",
		});

		contentEl.createEl("div", {
			text: `${this.date}  ${this.startTime} - ${this.endTime}`,
			cls: "chronos-quick-add-subtext",
		});

		const allTasks = this.store.getAllTasks();

		if (allTasks.length === 0) {
			contentEl.createEl("p", {
				text: "No tasks available. Create tasks in the task list first.",
				cls: "chronos-empty-desc",
			});
			return;
		}

		const searchContainer = contentEl.createEl("div", { cls: "chronos-quick-add-search" });
		const searchInput = searchContainer.createEl("input", {
			type: "text",
			placeholder: "Search tasks...",
			cls: "chronos-quick-add-search-input",
		});

		const list = contentEl.createEl("div", { cls: "chronos-quick-add-list" });

		const renderList = (filter: string) => {
			list.empty();
			const filtered = filter
				? allTasks.filter((t) => t.title.toLowerCase().includes(filter.toLowerCase()))
				: allTasks;

			if (filtered.length === 0) {
				list.createEl("div", {
					text: "No matching tasks",
					cls: "chronos-empty-desc",
				});
				return;
			}

			for (const task of filtered) {
				const row = list.createEl("div", { cls: "chronos-quick-add-row" });
				const color = task.color ?? TASK_COLORS[task.type];

				const rowBadge = row.createEl("span", {
					text: TASK_TYPE_LABELS[task.type],
					cls: "chronos-badge",
				});
				rowBadge.style.backgroundColor = color;

				row.createEl("span", { text: task.title, cls: "chronos-quick-add-task-name" });

				row.addEventListener("click", () => {
					void (async () => {
						await this.store.addScheduleEntry(task.id, {
							date: this.date,
							startTime: this.startTime,
							endTime: this.endTime,
						});
						this.onChanged();
						this.close();
					})();
				});
			}
		};

		renderList("");

		searchInput.addEventListener("input", () => {
			renderList(searchInput.value);
		});

		setTimeout(() => searchInput.focus(), 50);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
