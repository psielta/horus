import { HorusSQLiteConnection } from '../horusSQLiteConnection.js';

export class HorusDiagramRepository {
	constructor(readonly connection: HorusSQLiteConnection) { }
}
