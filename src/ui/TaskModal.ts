import { App, Modal, Setting } from "obsidian";
import { ChronosTask, TaskType, TaskStatus, TASK_TYPE_LABELS, STATUS_LABELS } from "../types";
import { ChronosStore } from "../store";

interface TaskFormData {
	title: string;
	type: TaskType;
	status: TaskStatus;
	startDate: string;
	endDate: string;
	progress: number;
	parentId: string;
	description: string;
}

export class TaskModal extends Modal {
	private store: ChronosStore;
	private editingTask: ChronosTask | null;
	private defaultParentId: string;
	private formData: TaskFormData;
	private onSaved: () => void;

	constructor(
		app: App,
		store: ChronosStore,
		opts: {
			editingTask?: ChronosTask;
			defaultParentId?: string;
			onSaved: () => void;
		}
	) {
		super(app);
		this.store = store;
		this.editingTask = opts.editingTask ?? null;
		this.defaultParentId = opts.defaultParentId ?? "";
		this.onSaved = opts.onSaved;

		const today = formatDateStr(new Date());
		const nextWeek = formatDateStr(new Date(Date.now() + 7 * 86400000));

		this.formData = this.editingTask
			? {
					title: this.editingTask.title,
					type: this.editingTask.type,
					status: this.editingTask.status,
					startDate: this.editingTask.startDate,
					endDate: this.editingTask.endDate,
					progress: this.editingTask.progress,
					parentId: this.editingTask.parentId ?? "",
					description: this.editingTask.description ?? "",
			  }
			: {
					title: "",
					type: "task" as TaskType,
					status: "todo" as TaskStatus,
					startDate: today,
					endDate: nextWeek,
					progress: 0,
					parentId: this.defaultParentId,
					description: "",
			  };
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("chronos-modal");

		contentEl.createEl("h2", {
			text: this.editingTask ? "Edit Task" : "New Task",
		});

		// Title
		new Setting(contentEl).setName("Title").addText((text) =>
			text
				.setPlaceholder("Task title")
				.setValue(this.formData.title)
				.onChange((v) => (this.formData.title = v))
		);

		// Type
		new Setting(contentEl).setName("Type").addDropdown((dd) => {
			for (const [value, label] of Object.entries(TASK_TYPE_LABELS)) {
				dd.addOption(value, label);
			}
			dd.setValue(this.formData.type);
			dd.onChange((v) => (this.formData.type = v as TaskType));
		});

		// Status
		new Setting(contentEl).setName("Status").addDropdown((dd) => {
			for (const [value, label] of Object.entries(STATUS_LABELS)) {
				dd.addOption(value, label);
			}
			dd.setValue(this.formData.status);
			dd.onChange((v) => {
				this.formData.status = v as TaskStatus;
				if (v === "done") this.formData.progress = 100;
			});
		});

		// Parent
		const parentCandidates = this.getParentCandidates();
		if (parentCandidates.length > 0) {
			new Setting(contentEl).setName("Parent").addDropdown((dd) => {
				dd.addOption("", "(None - Root level)");
				for (const c of parentCandidates) {
					dd.addOption(c.id, `${TASK_TYPE_LABELS[c.type]}: ${c.title}`);
				}
				dd.setValue(this.formData.parentId);
				dd.onChange((v) => (this.formData.parentId = v));
			});
		}

		// Start Date
		new Setting(contentEl).setName("Start Date").addText((text) => {
			text.inputEl.type = "date";
			text.setValue(this.formData.startDate);
			text.onChange((v) => (this.formData.startDate = v));
		});

		// End Date
		new Setting(contentEl).setName("End Date").addText((text) => {
			text.inputEl.type = "date";
			text.setValue(this.formData.endDate);
			text.onChange((v) => (this.formData.endDate = v));
		});

		// Progress
		new Setting(contentEl).setName("Progress (%)").addSlider((slider) =>
			slider
				.setLimits(0, 100, 5)
				.setValue(this.formData.progress)
				.setDynamicTooltip()
				.onChange((v) => (this.formData.progress = v))
		);

		// Description
		new Setting(contentEl).setName("Description").addTextArea((ta) =>
			ta
				.setPlaceholder("Optional description...")
				.setValue(this.formData.description)
				.onChange((v) => (this.formData.description = v))
		);

		// Buttons
		const btnContainer = contentEl.createEl("div", { cls: "chronos-modal-buttons" });

		const saveBtn = btnContainer.createEl("button", {
			text: this.editingTask ? "Save" : "Create",
			cls: "mod-cta",
		});
		saveBtn.addEventListener("click", () => this.handleSave());

		const cancelBtn = btnContainer.createEl("button", { text: "Cancel" });
		cancelBtn.addEventListener("click", () => this.close());
	}

	private getParentCandidates(): ChronosTask[] {
		const all = this.store.getAllTasks();
		const editingId = this.editingTask?.id;
		// Only epics and stories can be parents
		return all.filter(
			(t) =>
				(t.type === "epic" || t.type === "story") &&
				t.id !== editingId
		);
	}

	private async handleSave() {
		if (!this.formData.title.trim()) return;

		if (this.editingTask) {
			await this.store.updateTask(this.editingTask.id, {
				title: this.formData.title,
				type: this.formData.type,
				status: this.formData.status,
				startDate: this.formData.startDate,
				endDate: this.formData.endDate,
				progress: this.formData.progress,
				parentId: this.formData.parentId || undefined,
				description: this.formData.description || undefined,
			});
		} else {
			await this.store.addTask({
				title: this.formData.title,
				type: this.formData.type,
				status: this.formData.status,
				startDate: this.formData.startDate,
				endDate: this.formData.endDate,
				progress: this.formData.progress,
				parentId: this.formData.parentId || undefined,
				dependencies: [],
				description: this.formData.description || undefined,
			});
		}

		this.onSaved();
		this.close();
	}

	onClose() {
		this.contentEl.empty();
	}
}

function formatDateStr(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}
