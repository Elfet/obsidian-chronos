import { Plugin } from "obsidian";
import { ChronosData, ChronosTask, DEFAULT_DATA, ScheduleEntry } from "./types";

type Listener = () => void;

/**
 * Central data store for tasks. Persists to plugin data.json.
 */
export class ChronosStore {
	private data: ChronosData = { ...DEFAULT_DATA, tasks: [] };
	private plugin: Plugin;
	private listeners: Set<Listener> = new Set();

	constructor(plugin: Plugin) {
		this.plugin = plugin;
	}

	async load(): Promise<void> {
		const saved = await this.plugin.loadData();
		if (saved?.tasks) {
			this.data = { tasks: saved.tasks };
		}
	}

	private async save(): Promise<void> {
		await this.plugin.saveData(this.data);
		this.notify();
	}

	/** Subscribe to data changes */
	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		for (const listener of this.listeners) {
			listener();
		}
	}

	// --- Queries ---

	getAllTasks(): ChronosTask[] {
		return [...this.data.tasks].sort((a, b) => a.order - b.order);
	}

	getTask(id: string): ChronosTask | undefined {
		return this.data.tasks.find((t) => t.id === id);
	}

	getRootTasks(): ChronosTask[] {
		return this.getAllTasks().filter((t) => !t.parentId);
	}

	getChildren(parentId: string): ChronosTask[] {
		return this.getAllTasks().filter((t) => t.parentId === parentId);
	}

	getDescendants(parentId: string): ChronosTask[] {
		const result: ChronosTask[] = [];
		const children = this.getChildren(parentId);
		for (const child of children) {
			result.push(child);
			result.push(...this.getDescendants(child.id));
		}
		return result;
	}

	getTaskTree(): { task: ChronosTask; depth: number }[] {
		const result: { task: ChronosTask; depth: number }[] = [];
		const walk = (parentId: string | undefined, depth: number) => {
			const items = this.getAllTasks().filter((t) =>
				parentId ? t.parentId === parentId : !t.parentId
			);
			for (const item of items) {
				result.push({ task: item, depth });
				walk(item.id, depth + 1);
			}
		};
		walk(undefined, 0);
		return result;
	}

	getGanttTasks(): { task: ChronosTask; depth: number }[] {
		return this.getTaskTree().filter(
			({ task }) => task.startDate && task.endDate
		);
	}

	// --- Mutations ---

	async addTask(task: Omit<ChronosTask, "id" | "order">): Promise<ChronosTask> {
		const siblings = task.parentId
			? this.getChildren(task.parentId)
			: this.getRootTasks();
		const maxOrder = siblings.length > 0
			? Math.max(...siblings.map((s) => s.order))
			: -1;

		const newTask: ChronosTask = {
			...task,
			id: generateId(),
			order: maxOrder + 1,
		};
		this.data.tasks.push(newTask);
		await this.save();
		return newTask;
	}

	async updateTask(id: string, updates: Partial<Omit<ChronosTask, "id">>): Promise<void> {
		const idx = this.data.tasks.findIndex((t) => t.id === id);
		if (idx === -1) return;
		this.data.tasks[idx] = { ...this.data.tasks[idx], ...updates };

		const task = this.data.tasks[idx];
		if (task.parentId) {
			await this.recalcParentProgress(task.parentId);
			return;
		}
		await this.save();
	}

	async deleteTask(id: string): Promise<void> {
		const descendants = this.getDescendants(id);
		const idsToDelete = new Set([id, ...descendants.map((d) => d.id)]);
		this.data.tasks = this.data.tasks.filter((t) => !idsToDelete.has(t.id));

		for (const task of this.data.tasks) {
			task.dependencies = task.dependencies.filter((d) => !idsToDelete.has(d));
		}

		await this.save();
	}

	async reorderTask(id: string, newOrder: number): Promise<void> {
		const task = this.getTask(id);
		if (!task) return;

		const siblings = task.parentId
			? this.getChildren(task.parentId)
			: this.getRootTasks();

		const sorted = siblings.filter((s) => s.id !== id).sort((a, b) => a.order - b.order);
		sorted.splice(newOrder, 0, task);
		sorted.forEach((s, i) => {
			const idx = this.data.tasks.findIndex((t) => t.id === s.id);
			if (idx !== -1) this.data.tasks[idx].order = i;
		});

		await this.save();
	}

	// --- Schedule ---

	getScheduleForDate(date: string): { task: ChronosTask; entry: ScheduleEntry }[] {
		const results: { task: ChronosTask; entry: ScheduleEntry }[] = [];
		for (const task of this.data.tasks) {
			if (!task.schedule) continue;
			for (const entry of task.schedule) {
				if (entry.date === date) {
					results.push({ task, entry });
				}
			}
		}
		return results.sort((a, b) => a.entry.startTime.localeCompare(b.entry.startTime));
	}

	async addScheduleEntry(taskId: string, entry: ScheduleEntry): Promise<void> {
		const idx = this.data.tasks.findIndex((t) => t.id === taskId);
		if (idx === -1) return;
		const schedule = this.data.tasks[idx].schedule;
		if (!schedule) {
			this.data.tasks[idx].schedule = [entry];
		} else {
			schedule.push(entry);
		}
		await this.save();
	}

	async updateScheduleEntry(
		taskId: string,
		date: string,
		origStartTime: string,
		updates: Partial<ScheduleEntry>
	): Promise<void> {
		const idx = this.data.tasks.findIndex((t) => t.id === taskId);
		if (idx === -1) return;
		const entries = this.data.tasks[idx].schedule;
		if (!entries) return;
		const entryIdx = entries.findIndex(
			(e) => e.date === date && e.startTime === origStartTime
		);
		if (entryIdx === -1) return;
		entries[entryIdx] = { ...entries[entryIdx], ...updates };
		await this.save();
	}

	async removeScheduleEntry(taskId: string, date: string, startTime: string): Promise<void> {
		const idx = this.data.tasks.findIndex((t) => t.id === taskId);
		if (idx === -1) return;
		const entries = this.data.tasks[idx].schedule;
		if (!entries) return;
		this.data.tasks[idx].schedule = entries.filter(
			(e) => !(e.date === date && e.startTime === startTime)
		);
		await this.save();
	}

	private async recalcParentProgress(parentId: string): Promise<void> {
		const children = this.getChildren(parentId);
		if (children.length === 0) {
			await this.save();
			return;
		}
		const avgProgress = Math.round(
			children.reduce((sum, c) => sum + c.progress, 0) / children.length
		);
		const idx = this.data.tasks.findIndex((t) => t.id === parentId);
		if (idx !== -1) {
			this.data.tasks[idx].progress = avgProgress;
			const pid = this.data.tasks[idx].parentId;
			if (pid) {
				await this.recalcParentProgress(pid);
				return;
			}
		}
		await this.save();
	}
}

function generateId(): string {
	return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
