import { registerSharedProcessRemoteService } from '../../../../platform/ipc/electron-browser/services.js';
import { HORUS_STORAGE_CHANNEL, IHorusStorageService } from '../../../../platform/horus/common/horusStorage.js';
import { HorusStorageChannelClient } from '../../../../platform/horus/electron-browser/horusStorageClient.js';

import '../browser/horus.contribution.js';

registerSharedProcessRemoteService(IHorusStorageService, HORUS_STORAGE_CHANNEL, { channelClientCtor: HorusStorageChannelClient });
