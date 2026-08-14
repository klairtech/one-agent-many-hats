/**
 * Letting the agent arrange its own follow-up work (ADR-0008).
 *
 * The safety here is in what is *absent*. There is no `profile` parameter and no
 * `allowTools` parameter, so there is no string the model can emit that raises the
 * privilege of what it schedules — the schedule is read-only because nothing in the schema
 * can make it otherwise. And an unattended run cannot call this at all, which is what stops
 * one schedule from becoming two.
 */

import { HatsError } from '../../core/errors.js';
import { createSchedule, listSchedules } from '../../schedule/store.js';
import { describeSchedule, nextFire, parseSchedule } from '../../schedule/cron.js';
import type { ToolHandler, ToolResult } from '../types.js';

/** Above this, the agent is accumulating timers rather than managing them. */
const MAX_AGENT_SCHEDULES = 20;

export const scheduleTask: ToolHandler = {
  spec: {
    name: 'schedule_task',
    description:
      'Arrange for something to be looked at again later, on a timetable. The scheduled run is always read-only: it can read, search and report, and it cannot write files, run commands or change anything. Use it for monitoring and re-checks ("see whether this is still failing tomorrow morning"), not to defer work you could do now.',
    parameters: {
      type: 'object',
      properties: {
        request: {
          type: 'string',
          description:
            'What the scheduled run should do, written so it makes sense on its own — it will run with none of this conversation for context.',
        },
        when: {
          type: 'string',
          description:
            'A cron expression (minute hour day-of-month month day-of-week), or @daily, @hourly, @weekly, or @every 30m.',
        },
        why: {
          type: 'string',
          description: 'Why this needs revisiting: what you saw that makes a re-check worthwhile.',
        },
      },
      required: ['request', 'when', 'why'],
    },
    // Mutating, so an interactive run puts it in front of the human like any other change.
    mutating: true,
    network: false,
    minProfile: 'read-only',
  },

  async run(args, ctx): Promise<ToolResult> {
    // ADR-0008 §3. Without this, a schedule can create schedules and the count grows with
    // nobody watching — each individual run well-behaved, the total unbounded.
    if (ctx.unattended) {
      throw new HatsError(
        'TOOL_NOT_ALLOWED',
        'a scheduled or messaged run cannot create more schedules. Report what you think should ' +
          'be scheduled and why, and the person reading this can arrange it.',
        { adr: 'ADR-0008' },
        'rule/mutation-requires-approval',
      );
    }

    const request = String(args['request'] ?? '').trim();
    const when = String(args['when'] ?? '').trim();
    const why = String(args['why'] ?? '').trim();
    if (!request || !when) {
      throw new HatsError('TOOL_INPUT_INVALID', 'schedule_task needs both request and when', {});
    }

    // Parsed here so a bad expression is a tool error the model can correct, rather than a
    // half-created schedule.
    const parsed = parseSchedule(when);
    const next = nextFire(parsed, new Date());
    if (next === null) {
      throw new HatsError(
        'TOOL_INPUT_INVALID',
        `"${when}" never fires — check the day and month fields`,
        { when },
      );
    }

    const existing = await listSchedules();
    const mine = existing.filter((s) => s.author.startsWith('agent'));
    if (mine.length >= MAX_AGENT_SCHEDULES) {
      throw new HatsError(
        'TOOL_NOT_ALLOWED',
        `there are already ${mine.length} schedules you created. Remove some before adding more.`,
        { limit: MAX_AGENT_SCHEDULES },
      );
    }
    // A duplicate timer is worse than no timer: it fires twice and doubles the spend.
    const duplicate = existing.find(
      (s) => s.request.trim().toLowerCase() === request.toLowerCase() && s.enabled,
    );
    if (duplicate) {
      return {
        summary: `Already scheduled as ${duplicate.id} (${duplicate.expression}). Nothing new was created.`,
        payload: { existing: duplicate.id },
      };
    }

    const record = await createSchedule({
      request,
      expression: when,
      workspace: ctx.workspaceRoot,
      // Neither profile nor allowTools is passed. createSchedule defaults to read-only with
      // an empty allow list, which is the only thing this tool can produce.
      author: `agent (run ${ctx.runId})`,
    });

    return {
      summary:
        `Scheduled ${record.id}: ${describeSchedule(parsed)}, first run ${next.toLocaleString()}. ` +
        `It runs read-only, so it will report rather than change anything. ` +
        `The person can see it with "hats schedule list" and remove it with "hats schedule rm ${record.id}".`,
      payload: {
        id: record.id,
        expression: record.expression,
        next: next.toISOString(),
        profile: record.profile,
        why,
      },
      provenance: { adr: 'ADR-0008', author: record.author },
    };
  },
};
