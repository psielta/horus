import { HorusSQLiteConnection } from '../horusSQLiteConnection.js';

export class HorusNotebookRepository {
	constructor(readonly connection: HorusSQLiteConnection) { }
}
