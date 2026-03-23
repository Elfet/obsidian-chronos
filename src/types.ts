/** Task type in the hierarchy */
export type TaskType = "epic" | "story" | "task";

/** Task status */
export type TaskStatus = "todo" | "in-progress" | "done";

/** A single scheduled time block */
export interface ScheduleEntry {
	date: string;      // YYYY-MM-DD
	startTime: string; // HH:MM (24h)
	endTime: string;   // HH:MM (24h)
}

/** A single task item */
export interface ChronosTask {
	id: string;
	title: string;
	type: TaskType;
	status: TaskStatus;
	startDate: string; // YYYY-MM-DD
	endDate: string;   // YYYY-MM-DD
	progress: number;  // 0-100
	parentId?: string; // parent task id (epic->story->task)
	dependencies: string[];
	color?: string;
	description?: string;
	order: number; // sort order within siblings
	schedule?: ScheduleEntry[]; // day schedule time blocks
}

/** All plugin data */
export interface ChronosData {
	tasks: ChronosTask[];
}

/** Plugin settings */
export interface ChronosSettings {
	showWeekends: boolean;
}

export const DEFAULT_SETTINGS: ChronosSettings = {
	showWeekends: true,
};

export const DEFAULT_DATA: ChronosData = {
	tasks: [],
};

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
	epic: "Epic",
	story: "Story",
	task: "Task",
};

export const STATUS_LABELS: Record<TaskStatus, string> = {
	"todo": "To Do",
	"in-progress": "In Progress",
	"done": "Done",
};

export const TASK_COLORS: Record<TaskType, string> = {
	epic: "#845ef7",
	story: "#4a9eff",
	task: "#51cf66",
};
