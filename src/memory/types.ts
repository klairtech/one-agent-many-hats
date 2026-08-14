/**
 * Memory layers by lifetime and owner (paper §5). Collapsing these into one store gets
 * all of them wrong, so they are separate types with separate files and separate rules
 * about who may write them.
 */

/** Layer 5: the system's memory of its own mistakes. Behavioural only. */
export type LessonScope = 'run' | 'workspace' | 'global';
export type LessonStatus = 'draft' | 'canary' | 'active' | 'disabled';
export type LessonSource = 'failure' | 'correction' | 'feedback' | 'pack';

export interface Lesson {
  id: string;
  text: string;
  scope: LessonScope;
  status: LessonStatus;
  /** 0..1. Acceptance raises it, rejection lowers it, contradiction disables it. */
  confidence: number;
  source: LessonSource;
  createdAt: string;
  updatedAt: string;
  /** Runs this lesson was injected into — the canary denominator. */
  injectedRuns: string[];
  /** Times the lesson's tags matched the request. A lesson that never matches is noise. */
  matches: number;
  accepts: number;
  rejects: number;
  tags: string[];
  /** Why it was disabled, when it was. */
  retiredReason?: string;
}

/** Layer 3: compact question/answer takeaways, filtered by feedback. */
export type FeedbackVerdict = 'none' | 'accepted' | 'rejected' | 'corrected';

export interface Takeaway {
  id: string;
  runId: string;
  question: string;
  answer: string;
  createdAt: string;
  feedback: FeedbackVerdict;
  /** Present when feedback is 'corrected': what the answer should have been. */
  correction?: string;
  tags: string[];
  embedding?: number[];
}

/** Layer 2: a rolling, size-bounded sketch of the user. Useful when right, harmless when stale. */
export interface Persona {
  summary: string;
  facts: string[];
  runCount: number;
  updatedAt: string;
}

export interface RetrievalHit {
  text: string;
  source: string;
  score: number;
}

/** What the orchestrator injects into a run's context. */
export interface ComposedMemory {
  /** Rendered block for the system prompt. */
  block: string;
  lessonIds: string[];
  takeawayIds: string[];
  /** Layers that were empty — the router reads this for the conservative profile (§5.1). */
  emptyLayers: string[];
}
