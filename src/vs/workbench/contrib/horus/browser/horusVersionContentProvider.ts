import { URI } from '../../../../base/common/uri.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ITextModelContentProvider, ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { IHorusStorageService } from '../../../../platform/horus/common/horusStorage.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';

export const HORUS_VERSION_CONTENT_SCHEME = 'horus-version';

interface HorusVersionResourceQuery {
	readonly kind: 'prompt' | 'linkedDocument';
	readonly id: string;
	readonly versionNumber: number;
}

export function createHorusPromptVersionResource(promptId: string, versionNumber: number): URI {
	return URI.from({
		scheme: HORUS_VERSION_CONTENT_SCHEME,
		path: `/prompt/${promptId}/v${versionNumber}.md`,
		query: JSON.stringify({ kind: 'prompt', id: promptId, versionNumber } satisfies HorusVersionResourceQuery)
	});
}

export function createHorusLinkedDocumentVersionResource(linkedDocumentId: string, versionNumber: number): URI {
	return URI.from({
		scheme: HORUS_VERSION_CONTENT_SCHEME,
		path: `/linked-document/${linkedDocumentId}/v${versionNumber}.md`,
		query: JSON.stringify({ kind: 'linkedDocument', id: linkedDocumentId, versionNumber } satisfies HorusVersionResourceQuery)
	});
}

export class HorusVersionContentProvider implements ITextModelContentProvider, IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.horus.versionContentProvider';

	constructor(
		@ITextModelService textModelService: ITextModelService,
		@IModelService private readonly modelService: IModelService,
		@ILanguageService private readonly languageService: ILanguageService,
		@IHorusStorageService private readonly horusStorageService: IHorusStorageService
	) {
		textModelService.registerTextModelContentProvider(HORUS_VERSION_CONTENT_SCHEME, this);
	}

	async provideTextContent(resource: URI): Promise<ITextModel | null> {
		const existing = this.modelService.getModel(resource);
		if (existing && !existing.isDisposed()) {
			return existing;
		}

		const query = this.parseQuery(resource);
		if (!query) {
			return null;
		}

		const content = query.kind === 'prompt'
			? (await this.horusStorageService.getPromptVersion(query.id, query.versionNumber))?.content
			: (await this.horusStorageService.getLinkedDocumentVersion(query.id, query.versionNumber))?.content;

		if (content === undefined) {
			return null;
		}

		return this.modelService.createModel(content, this.languageService.createById('markdown'), resource, false);
	}

	private parseQuery(resource: URI): HorusVersionResourceQuery | undefined {
		try {
			const value = JSON.parse(resource.query) as Partial<HorusVersionResourceQuery>;
			if ((value.kind === 'prompt' || value.kind === 'linkedDocument') && typeof value.id === 'string' && typeof value.versionNumber === 'number') {
				return value as HorusVersionResourceQuery;
			}
		} catch {
			return undefined;
		}

		return undefined;
	}
}
