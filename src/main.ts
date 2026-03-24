import { Plugin, WorkspaceLeaf } from "obsidian";
import { ChronosSettings, DEFAULT_SETTINGS } from "./types";
import { ChronosStore } from "./store";
import { TaskListView, TASK_LIST_VIEW_TYPE } from "./ui/TaskListView";
import { GanttView, GANTT_VIEW_TYPE } from "./ui/GanttView";
import { DayScheduleView, DAY_SCHEDULE_VIEW_TYPE } from "./ui/DayScheduleView";

export default class ChronosPlugin extends Plugin {
	settings: ChronosSettings = DEFAULT_SETTINGS;
	store: ChronosStore = new ChronosStore(this);

	async onload() {
		await this.loadSettings();
		await this.store.load();

		// Register views
		this.registerView(TASK_LIST_VIEW_TYPE, (leaf) => new TaskListView(leaf, this.store));
		this.registerView(GANTT_VIEW_TYPE, (leaf) => new GanttView(leaf, this.store));
		this.registerView(DAY_SCHEDULE_VIEW_TYPE, (leaf) => new DayScheduleView(leaf, this.store));

		// Ribbon icons
		this.addRibbonIcon("list-checks", "Chronos tasks", () => { void this.activateView(TASK_LIST_VIEW_TYPE); });
		this.addRibbonIcon("gantt-chart", "Chronos gantt", () => { void this.activateView(GANTT_VIEW_TYPE); });
		this.addRibbonIcon("calendar-clock", "Chronos schedule", () => { void this.activateView(DAY_SCHEDULE_VIEW_TYPE); });

		// Commands
		this.addCommand({
			id: "open-task-list",
			name: "Open task list",
			callback: () => { void this.activateView(TASK_LIST_VIEW_TYPE); },
		});

		this.addCommand({
			id: "open-gantt-chart",
			name: "Open gantt chart",
			callback: () => { void this.activateView(GANTT_VIEW_TYPE); },
		});

		this.addCommand({
			id: "open-day-schedule",
			name: "Open day schedule",
			callback: () => { void this.activateView(DAY_SCHEDULE_VIEW_TYPE); },
		});
	}

	async activateView(viewType: string): Promise<void> {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(viewType);

		if (leaves.length > 0) {
			leaf = leaves[0];
		} else {
			leaf = workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.setViewState({ type: viewType, active: true });
			}
		}

		if (leaf) {
			await workspace.revealLeaf(leaf);
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
