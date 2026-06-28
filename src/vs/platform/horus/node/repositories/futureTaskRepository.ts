import { HorusSQLiteConnection } from '../horusSQLiteConnection.js';

export class HorusFutureTaskRepository {
	constructor(readonly connection: HorusSQLiteConnection) { }
}
