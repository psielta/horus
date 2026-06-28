import * as assert from 'assert';
import { access, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from '../../../../base/common/path.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IFileService } from '../../../files/common/files.js';
import { HorusFileValidationService } from '../../node/horusFileValidationService.js';

suite('HorusFileMention', () => {

	let root: string | undefined;

	setup(async () => {
		root = join(tmpdir(), 'horus-tests', `file-mentions-${Date.now()}-${Math.random().toString(16).slice(2)}`);
		await mkdir(join(root, 'src'), { recursive: true });
		await writeFile(join(root, 'src', 'index.ts'), 'export const value = 1;');
		await writeFile(join(root, '.gitignore'), 'ignored/\n*.log\n');
	});

	teardown(async () => {
		if (root) {
			await rm(root, { recursive: true, force: true });
			root = undefined;
		}
	});

	test('validates existing, missing, ignored and escaping mentions', async () => {
		const service = new HorusFileValidationService(createFileService());
		const results = await service.validateMentions({
			workspacePath: root!,
			mentions: ['@src/index.ts', '@src/missing.ts', '@ignored/file.ts', '@../outside.ts', '@debug.log']
		});

		assert.strictEqual(results[0].exists, true);
		assert.strictEqual(results[1].exists, false);
		assert.strictEqual(results[2].exists, false);
		assert.strictEqual(results[3].exists, false);
		assert.strictEqual(results[4].exists, false);
	});

	function createFileService(): IFileService {
		return {
			exists: async (resource: URI) => {
				try {
					await access(resource.fsPath);
					return true;
				} catch {
					return false;
				}
			}
		} as unknown as IFileService;
	}

	ensureNoDisposablesAreLeakedInTestSuite();
});
