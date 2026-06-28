export interface HorusMigration {
	readonly version: number;
	readonly description: string;
	readonly statements: readonly string[];
}

export interface HorusAppliedMigration {
	readonly version: number;
	readonly description: string;
	readonly checksum: string;
	readonly appliedAt: string;
}
