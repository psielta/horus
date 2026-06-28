import { HorusSQLiteConnection } from '../horusSQLiteConnection.js';

export class HorusChatRepository {
	constructor(readonly connection: HorusSQLiteConnection) { }
}
