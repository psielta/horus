import { HorusSQLiteConnection } from '../horusSQLiteConnection.js';

export class HorusLinkedDocumentRepository {
	constructor(readonly connection: HorusSQLiteConnection) { }
}
