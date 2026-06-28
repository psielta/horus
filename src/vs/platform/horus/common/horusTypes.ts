export const HORUS_SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000001';

export type HorusUuid = string;
export type HorusDateTime = string;

export const enum HorusTargetAgent {
	ClaudeCode = 1,
	Codex = 2,
	Grok = 3
}

export const enum HorusPromptKind {
	General = 1,
	Plan = 2,
	Review = 3,
	Implementation = 4
}

export const enum HorusPromptStatus {
	Draft = 1,
	Active = 2,
	Archived = 3
}

export const enum HorusLinkedDocumentType {
	ClaudeCodePlan = 1
}

export const enum HorusLinkedDocumentStatus {
	Draft = 1,
	Watching = 2,
	Paused = 3,
	Error = 4
}

export const enum HorusLinkedDocumentVersionSource {
	Initial = 1,
	FileWatcher = 2,
	ManualRefresh = 3
}

export const enum HorusWorkflowActor {
	ClaudeCode = 1,
	Codex = 2,
	Human = 3,
	Grok = 4
}

export const enum HorusWorkflowStatus {
	Active = 1,
	Done = 2
}

export const enum HorusWorkflowEventType {
	WorkflowStarted = 1,
	PhaseChanged = 2,
	ActorChanged = 3,
	Note = 4,
	Completed = 5,
	Reopened = 6,
	PhasesEdited = 7
}

export const enum HorusWorkflowPhaseRole {
	PromptEngineering = 1,
	Planning = 2,
	PlanReview = 3,
	PlanCorrection = 4,
	Implementation = 5,
	CodeReview = 6,
	ReviewCorrection = 7,
	PracticalTest = 8,
	Rebase = 9,
	Merge = 10
}

export const enum HorusDiagramType {
	Excalidraw = 1,
	Mermaid = 2
}

export const enum HorusFutureTaskStatus {
	Open = 1,
	InProgress = 2,
	Done = 3,
	Archived = 4
}

export const enum HorusFutureTaskType {
	Bug = 1,
	Feature = 2,
	Task = 3
}

export interface HorusEntity {
	readonly id: HorusUuid;
}

export interface HorusAuditableEntity extends HorusEntity {
	readonly ownerId: HorusUuid;
	readonly createdAtUtc: HorusDateTime;
	readonly updatedAtUtc: HorusDateTime;
}

export interface HorusUser extends HorusEntity {
	readonly displayName: string;
	readonly isSystem: boolean;
	readonly createdAtUtc: HorusDateTime;
}

export interface HorusWorkspace extends HorusAuditableEntity {
	readonly name: string;
	readonly absolutePath: string;
	readonly respectGitignore: boolean;
	readonly enableAiContext: boolean;
	readonly taskNumberPattern: string | null;
	readonly promptCount?: number;
}

export interface HorusPrompt extends HorusAuditableEntity {
	readonly workingDirectoryId: HorusUuid;
	readonly parentPromptId: HorusUuid | null;
	readonly futureTaskId: HorusUuid | null;
	readonly taskNumber: string | null;
	readonly title: string;
	readonly content: string;
	readonly targetAgent: HorusTargetAgent;
	readonly kind: HorusPromptKind;
	readonly status: HorusPromptStatus;
	readonly currentVersion: number;
	readonly boardRank: number;
	readonly rowVersion: number;
}

export interface HorusPromptVersion extends HorusEntity {
	readonly promptId: HorusUuid;
	readonly versionNumber: number;
	readonly title: string;
	readonly content: string;
	readonly targetAgent: HorusTargetAgent;
	readonly kind: HorusPromptKind;
	readonly status: HorusPromptStatus;
	readonly changeNote: string | null;
	readonly createdAtUtc: HorusDateTime;
}

export interface HorusPromptFileReference extends HorusEntity {
	readonly promptId: HorusUuid;
	readonly relativePath: string;
	readonly rawMention: string;
	readonly exists: boolean;
	readonly resolvedAtUtc: HorusDateTime | null;
}

export interface HorusLinkedDocument extends HorusEntity {
	readonly promptId: HorusUuid;
	readonly workingDirectoryId: HorusUuid | null;
	readonly absolutePath: string;
	readonly absolutePathKey: string;
	readonly documentType: HorusLinkedDocumentType;
	readonly displayName: string | null;
	readonly status: HorusLinkedDocumentStatus;
	readonly pullRequestReference: string | null;
	readonly currentVersion: number;
	readonly lastContentHash: string | null;
	readonly lastError: string | null;
	readonly lastSyncedAtUtc: HorusDateTime | null;
	readonly sizeBytes: number | null;
	readonly createdAtUtc: HorusDateTime;
	readonly updatedAtUtc: HorusDateTime;
}

export interface HorusLinkedDocumentVersion extends HorusEntity {
	readonly linkedDocumentId: HorusUuid;
	readonly versionNumber: number;
	readonly content: string;
	readonly contentHash: string;
	readonly sizeBytes: number;
	readonly source: HorusLinkedDocumentVersionSource;
	readonly createdAtUtc: HorusDateTime;
}

export interface HorusWorkflowTemplate extends HorusAuditableEntity {
	readonly name: string;
	readonly isDefault: boolean;
}

export interface HorusWorkflowTemplatePhase extends HorusEntity {
	readonly workflowTemplateId: HorusUuid;
	readonly name: string;
	readonly defaultActor: HorusWorkflowActor;
	readonly orderIndex: number;
	readonly color: string;
	readonly role: HorusWorkflowPhaseRole | null;
}

export interface HorusPromptWorkflow extends HorusEntity {
	readonly promptId: HorusUuid;
	readonly status: HorusWorkflowStatus;
	readonly currentPhaseId: HorusUuid | null;
	readonly currentPhaseName: string | null;
	readonly currentPhaseColor: string | null;
	readonly currentActor: HorusWorkflowActor | null;
	readonly currentPhaseIteration: number;
	readonly reviewVerdictSourcePhaseName: string | null;
	readonly startedAtUtc: HorusDateTime;
	readonly enteredCurrentPhaseAtUtc: HorusDateTime | null;
	readonly createdAtUtc: HorusDateTime;
	readonly updatedAtUtc: HorusDateTime;
	readonly rowVersion: number;
}

export interface HorusPromptWorkflowPhase extends HorusEntity {
	readonly promptWorkflowId: HorusUuid;
	readonly name: string;
	readonly defaultActor: HorusWorkflowActor;
	readonly orderIndex: number;
	readonly color: string;
	readonly role: HorusWorkflowPhaseRole | null;
}

export interface HorusPromptWorkflowEvent extends HorusEntity {
	readonly promptWorkflowId: HorusUuid;
	readonly type: HorusWorkflowEventType;
	readonly phaseId: HorusUuid | null;
	readonly phaseNameSnapshot: string | null;
	readonly actor: HorusWorkflowActor | null;
	readonly note: string | null;
	readonly occurredAtUtc: HorusDateTime;
}

export interface HorusAiChatSession extends HorusAuditableEntity {
	readonly workingDirectoryId: HorusUuid | null;
	readonly promptId: HorusUuid | null;
	readonly title: string;
	readonly model: string;
	readonly temperature: number;
	readonly thinkingEnabled: boolean;
	readonly thinkingBudget: number | null;
	readonly thinkingLevel: string | null;
	readonly geminiCacheName: string | null;
	readonly cacheSystemInstructionHash: string | null;
	readonly cacheExpiresAt: HorusDateTime | null;
	readonly cachedThroughSequence: number;
}

export interface HorusAiChatMessage extends HorusEntity {
	readonly sessionId: HorusUuid;
	readonly role: string;
	readonly content: string;
	readonly sequence: number;
	readonly promptTokens: number | null;
	readonly candidateTokens: number | null;
	readonly cachedTokens: number | null;
	readonly createdAtUtc: HorusDateTime;
}

export interface HorusAiUserSettings extends HorusAuditableEntity {
	readonly model: string;
	readonly temperature: number;
	readonly thinkingEnabled: boolean;
	readonly thinkingBudget: number | null;
	readonly thinkingLevel: string | null;
}

export interface HorusAppUserSettings extends HorusAuditableEntity {
	readonly showAgentTerminalOfferAfterChildPrompt: boolean;
}

export interface HorusNotebook extends HorusAuditableEntity {
	readonly title: string;
	readonly description: string | null;
	readonly workingDirectoryId: HorusUuid | null;
	readonly isArchived: boolean;
}

export interface HorusNote extends HorusAuditableEntity {
	readonly notebookId: HorusUuid;
	readonly title: string;
	readonly contentMarkdown: string;
	readonly isPinned: boolean;
	readonly isArchived: boolean;
}

export interface HorusDiagram extends HorusAuditableEntity {
	readonly workingDirectoryId: HorusUuid;
	readonly title: string;
	readonly description: string | null;
	readonly type: HorusDiagramType;
	readonly content: string;
	readonly metadataJson: string | null;
	readonly isArchived: boolean;
}

export interface HorusFutureTask extends HorusAuditableEntity {
	readonly workingDirectoryId: HorusUuid;
	readonly title: string;
	readonly description: string;
	readonly status: HorusFutureTaskStatus;
	readonly type: HorusFutureTaskType;
	readonly issueGithubId: string | null;
	readonly rowVersion: number;
}

export interface HorusFutureTaskLabel extends HorusEntity {
	readonly futureTaskId: HorusUuid;
	readonly label: string;
}

export interface HorusDailyTaskSequence extends HorusEntity {
	readonly workingDirectoryId: HorusUuid;
	readonly sequenceDate: string;
	readonly currentValue: number;
	readonly createdAtUtc: HorusDateTime;
	readonly updatedAtUtc: HorusDateTime;
}

export interface HorusCreateWorkspaceData {
	readonly name: string;
	readonly absolutePath: string;
	readonly respectGitignore?: boolean;
	readonly enableAiContext?: boolean;
	readonly taskNumberPattern?: string | null;
}

export interface HorusCreatePromptData {
	readonly workingDirectoryId: HorusUuid;
	readonly parentPromptId?: HorusUuid | null;
	readonly futureTaskId?: HorusUuid | null;
	readonly taskNumber?: string | null;
	readonly title: string;
	readonly content: string;
	readonly targetAgent?: HorusTargetAgent;
	readonly kind?: HorusPromptKind;
	readonly status?: HorusPromptStatus;
	readonly changeNote?: string | null;
}

export interface HorusPromptQuery {
	readonly workingDirectoryId?: HorusUuid;
	readonly rootOnly?: boolean;
	readonly includeArchived?: boolean;
}

export interface HorusFileMentionValidationRequest {
	readonly workspacePath: string;
	readonly mentions: readonly string[];
	readonly respectGitignore?: boolean;
}

export interface HorusFileMentionValidationResult {
	readonly rawMention: string;
	readonly relativePath: string;
	readonly absolutePath: string;
	readonly exists: boolean;
}

export interface HorusStorageHealth {
	readonly databasePath: string;
	readonly journalMode: string;
	readonly foreignKeys: number;
	readonly userVersion: number;
}
