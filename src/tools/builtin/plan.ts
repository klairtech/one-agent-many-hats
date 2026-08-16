/**
 * A task list the run keeps, and cannot quietly abandon.
 *
 * The failure this exists for is not forgetfulness — it is the confident partial answer. A
 * run asked to do six things does four, and reports as though it did six, because by the
 * final step the first three are a summary of a summary and nothing anywhere holds the
 * original list. Every check in `vigilance.ts` compares the answer against what the *tools*
 * did; none of them knows what the work was supposed to be.
 *
 * So the list is a tool call. Writing it down puts it in the record, where the completion
 * gate can read it and where a person watching can see what is left. It is not a planning
 * aid — the model can already plan — it is an external memory of the commitment, kept
 * outside the context that gets compacted.
 *
 * Deliberately not a stage or a phase. Stages are what kind of work is happening; this is
 * what the work *is*, and it changes as the run learns.
 */

import { HatsError } from '../../core/errors.js';
import type { ToolHandler, ToolResult } from '../types.js';

export type TaskState = 'todo' | 'doing' | 'done' | 'dropped';

export interface Task {
  id: number;
  title: string;
  state: TaskState;
  /** Required when dropping: a task abandoned without a reason is a task nobody decided about. */
  note?: string;
}

/** One list per run. The runtime is single-run-at-a-time; the key keeps it honest anyway. */
const lists = new Map<string, Task[]>();

export function taskList(runId: string): Task[] {
  return lists.get(runId) ?? [];
}

export function resetTaskLists(): void {
  lists.clear();
}

function render(tasks: Task[]): string {
  const mark: Record<TaskState, string> = { todo: '[ ]', doing: '[~]', done: '[x]', dropped: '[-]' };
  return tasks.map((t) => `${mark[t.state]} ${t.id}. ${t.title}${t.note ? ` — ${t.note}` : ''}`).join('\n');
}

function counts(tasks: Task[]): string {
  const done = tasks.filter((t) => t.state === 'done').length;
  const dropped = tasks.filter((t) => t.state === 'dropped').length;
  const open = tasks.length - done - dropped;
  return `${done} done, ${open} open${dropped ? `, ${dropped} dropped` : ''}`;
}

export const planTasks: ToolHandler = {
  spec: {
    name: 'plan_tasks',
    description:
      'Write down the pieces of work this request breaks into, before starting them. Use it when the request has several distinct parts, or when finishing needs more than one round of tool calls — not for a single question with a single answer. Calling it again replaces the list, which is how you add something you discovered along the way. The list is checked against your answer at the end, so a piece you never finished cannot be quietly rolled into a summary that sounds complete.',
    parameters: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          items: { type: 'string' },
          description:
            'The pieces, in the order you mean to do them. Each one a thing that is either done or not — "read the config and summarise the caching section", not "investigate caching". Between two and a dozen; fewer means the list was not needed, more means the pieces are too small to be worth tracking.',
        },
      },
      required: ['tasks'],
    },
    mutating: false,
    network: false,
    minProfile: 'read-only',
  },

  async run(args, ctx): Promise<ToolResult> {
    const raw = Array.isArray(args['tasks']) ? (args['tasks'] as unknown[]).map((t) => String(t).trim()) : [];
    const titles = raw.filter(Boolean);
    if (titles.length === 0) {
      throw new HatsError('TOOL_INPUT_INVALID', 'a plan with no tasks in it is not a plan', {});
    }
    if (titles.length > 20) {
      throw new HatsError(
        'TOOL_INPUT_INVALID',
        `${titles.length} tasks is a plan for the whole project rather than this request — group them`,
        {},
      );
    }

    // Carry forward what is already finished. Re-planning mid-run is normal and losing the
    // record of completed work to it would make the list lie in the other direction.
    const before = taskList(ctx.runId);
    const tasks: Task[] = titles.map((title, i) => {
      const prior = before.find((t) => t.title === title);
      return { id: i + 1, title, state: prior?.state ?? 'todo', ...(prior?.note ? { note: prior.note } : {}) };
    });
    lists.set(ctx.runId, tasks);

    return {
      summary: `${tasks.length} tasks. Mark each one with update_task as you go.\n${render(tasks)}`,
      payload: tasks,
      provenance: { count: tasks.length },
    };
  },
};

export const updateTask: ToolHandler = {
  spec: {
    name: 'update_task',
    description:
      'Move one task to doing, done or dropped. Mark it done when it is actually finished, not when you have started it — the end of the run compares your answer against this list. Dropping one is a legitimate outcome and needs a reason: work that turned out to be unnecessary, or impossible with the access you have.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'The task number from plan_tasks.' },
        state: { type: 'string', enum: ['todo', 'doing', 'done', 'dropped'], description: 'Where it stands now.' },
        note: {
          type: 'string',
          description: 'Required when dropping: why it is not being done. Optional otherwise.',
        },
      },
      required: ['id', 'state'],
    },
    mutating: false,
    network: false,
    minProfile: 'read-only',
  },

  async run(args, ctx): Promise<ToolResult> {
    const tasks = taskList(ctx.runId);
    if (tasks.length === 0) {
      throw new HatsError('TOOL_INPUT_INVALID', 'there is no task list in this run — call plan_tasks first', {});
    }
    const id = Number(args['id']);
    const task = tasks.find((t) => t.id === id);
    if (!task) {
      throw new HatsError(
        'TOOL_INPUT_INVALID',
        `no task ${id}. The list is:\n${render(tasks)}`,
        { id },
      );
    }
    const state = String(args['state']) as TaskState;
    const note = String(args['note'] ?? '').trim();
    if (state === 'dropped' && !note) {
      throw new HatsError(
        'TOOL_INPUT_INVALID',
        'dropping a task needs a reason — say why it is not being done, so the answer can say it too',
        { id },
      );
    }

    task.state = state;
    if (note) task.note = note;

    return {
      summary: `${id}. ${task.title} → ${state}\n${counts(tasks)}\n${render(tasks)}`,
      payload: tasks,
      provenance: { id, state },
    };
  },
};

/**
 * What the completion gate reads: work that was written down and never finished.
 *
 * Only tasks in `todo` or `doing`. A dropped task was a decision, and the run is allowed to
 * make it — it just has to say so.
 */
export function unfinishedTasks(runId: string): Task[] {
  return taskList(runId).filter((t) => t.state === 'todo' || t.state === 'doing');
}

export const planTools = [planTasks, updateTask];
