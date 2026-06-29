import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { IActiveCodeEditor, ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IInlineChatSession, IInlineChatSessionService } from '../../inlineChat/browser/inlineChatSessionService.js';

class HorusNullInlineChatSessionService implements IInlineChatSessionService {

	declare _serviceBrand: undefined;

	readonly onWillStartSession: Event<IActiveCodeEditor> = Event.None;
	readonly onDidChangeSessions: Event<this> = Event.None;

	createSession(_editor: ICodeEditor): IInlineChatSession {
		throw new Error('Inline chat sessions are disabled in Horus.');
	}

	getSessionByTextModel(_uri: URI): IInlineChatSession | undefined {
		return undefined;
	}

	getSessionBySessionUri(_uri: URI): IInlineChatSession | undefined {
		return undefined;
	}
}

registerSingleton(IInlineChatSessionService, HorusNullInlineChatSessionService, InstantiationType.Delayed);
