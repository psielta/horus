import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { FileChangeType, IFileService } from '../../../../platform/files/common/files.js';
import { IHorusStorageService } from '../../../../platform/horus/common/horusStorage.js';
import { HorusLinkedDocument, HorusLinkedDocumentStatus, HorusLinkedDocumentVersionSource } from '../../../../platform/horus/common/horusTypes.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';

interface HorusTrackedLinkedPlan {
	readonly document: HorusLinkedDocument;
	readonly resource: URI;
}

export class HorusLinkedPlanMonitor extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.horus.linkedPlanMonitor';

	private readonly watches = this._register(new DisposableStore());
	private readonly trackedPlans = new Map<string, HorusTrackedLinkedPlan>();
	private readonly syncSchedulers = new Map<string, RunOnceScheduler>();
	private refreshing = false;

	constructor(
		@IHorusStorageService private readonly horusStorageService: IHorusStorageService,
		@IFileService private readonly fileService: IFileService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		this._register(this.fileService.onDidFilesChange(event => {
			for (const [id, tracked] of this.trackedPlans) {
				if (event.contains(tracked.resource, FileChangeType.ADDED, FileChangeType.UPDATED, FileChangeType.DELETED)) {
					this.scheduleSync(id);
				}
			}
		}));

		this._register(this.horusStorageService.onDidChangeData(event => {
			if (event.kind === 'linkedDocument' || event.kind === 'prompt' || event.kind === 'storage') {
				this.refreshWatches().catch(error => this.logService.warn(`[Horus] Failed to refresh linked plan watches: ${error}`));
			}
		}));

		this.refreshWatches()
			.then(() => this.syncTrackedPlansOnce())
			.catch(error => this.logService.warn(`[Horus] Failed to start linked plan monitor: ${error}`));
	}

	override dispose(): void {
		for (const scheduler of this.syncSchedulers.values()) {
			scheduler.dispose();
		}
		this.syncSchedulers.clear();
		super.dispose();
	}

	private async refreshWatches(): Promise<void> {
		if (this.refreshing) {
			return;
		}

		this.refreshing = true;
		try {
			const documents = await this.horusStorageService.listLinkedDocuments({
				status: HorusLinkedDocumentStatus.Watching,
				activePromptsOnly: true
			});

			this.watches.clear();
			this.trackedPlans.clear();
			for (const document of documents) {
				const resource = URI.file(document.absolutePath);
				this.trackedPlans.set(document.id, { document, resource });
				this.watches.add(this.fileService.watch(resource));
			}

			for (const [id, scheduler] of this.syncSchedulers) {
				if (!this.trackedPlans.has(id)) {
					scheduler.dispose();
					this.syncSchedulers.delete(id);
				}
			}
		} finally {
			this.refreshing = false;
		}
	}

	private async syncTrackedPlansOnce(): Promise<void> {
		for (const id of this.trackedPlans.keys()) {
			await this.syncLinkedPlan(id);
		}
	}

	private scheduleSync(linkedDocumentId: string): void {
		let scheduler = this.syncSchedulers.get(linkedDocumentId);
		if (!scheduler) {
			scheduler = this._register(new RunOnceScheduler(() => this.syncLinkedPlan(linkedDocumentId).catch(error => this.logService.warn(`[Horus] Failed to sync linked plan: ${error}`)), 500));
			this.syncSchedulers.set(linkedDocumentId, scheduler);
		}

		scheduler.schedule();
	}

	private async syncLinkedPlan(linkedDocumentId: string): Promise<void> {
		if (!this.trackedPlans.has(linkedDocumentId)) {
			return;
		}

		await this.horusStorageService.syncLinkedDocument(linkedDocumentId, HorusLinkedDocumentVersionSource.FileWatcher);
	}
}
