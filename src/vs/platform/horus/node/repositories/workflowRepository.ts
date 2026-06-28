import { HorusSQLiteConnection } from '../horusSQLiteConnection.js';

export class HorusWorkflowRepository {
	constructor(readonly connection: HorusSQLiteConnection) { }
}
