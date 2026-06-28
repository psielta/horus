import { readFile } from 'fs/promises';
import { isAbsolute, join, normalize, relative, sep } from '../../../base/common/path.js';
import { URI } from '../../../base/common/uri.js';
import { IFileService } from '../../files/common/files.js';
import { HorusFileMentionValidationRequest, HorusFileMentionValidationResult } from '../common/horusTypes.js';

export class HorusFileValidationService {

	constructor(@IFileService private readonly fileService: IFileService) { }

	async validateMentions(request: HorusFileMentionValidationRequest): Promise<readonly HorusFileMentionValidationResult[]> {
		const workspacePath = normalize(request.workspacePath);
		const gitignorePatterns = request.respectGitignore === false ? [] : await this.readGitignorePatterns(workspacePath);

		const results: HorusFileMentionValidationResult[] = [];
		for (const rawMention of request.mentions) {
			const relativePath = this.toRelativeMentionPath(rawMention);
			const absolutePath = normalize(isAbsolute(relativePath) ? relativePath : join(workspacePath, relativePath));

			if (!this.isInsideWorkspace(workspacePath, absolutePath) || this.isIgnored(workspacePath, absolutePath, gitignorePatterns)) {
				results.push({ rawMention, relativePath, absolutePath, exists: false });
				continue;
			}

			results.push({
				rawMention,
				relativePath,
				absolutePath,
				exists: await this.fileService.exists(URI.file(absolutePath))
			});
		}

		return results;
	}

	private toRelativeMentionPath(rawMention: string): string {
		return rawMention.trim().replace(/^@+/, '').replace(/^["']|["']$/g, '').replaceAll('/', sep);
	}

	private isInsideWorkspace(workspacePath: string, absolutePath: string): boolean {
		const workspace = workspacePath.toLowerCase();
		const candidate = absolutePath.toLowerCase();
		return candidate === workspace || candidate.startsWith(workspace.endsWith(sep) ? workspace : `${workspace}${sep}`);
	}

	private async readGitignorePatterns(workspacePath: string): Promise<readonly string[]> {
		try {
			const content = await readFile(join(workspacePath, '.gitignore'), 'utf8');
			return content
				.split(/\r?\n/g)
				.map(line => line.trim())
				.filter(line => line && !line.startsWith('#') && !line.startsWith('!'));
		} catch {
			return [];
		}
	}

	private isIgnored(workspacePath: string, absolutePath: string, patterns: readonly string[]): boolean {
		const relativePath = relative(workspacePath, absolutePath).replaceAll('\\', '/');
		for (const pattern of patterns) {
			const normalizedPattern = pattern.replaceAll('\\', '/').replace(/^\//, '');
			if (normalizedPattern.endsWith('/') && relativePath.startsWith(normalizedPattern)) {
				return true;
			}

			if (relativePath === normalizedPattern || relativePath.startsWith(`${normalizedPattern}/`)) {
				return true;
			}

			if (normalizedPattern.startsWith('*.') && relativePath.endsWith(normalizedPattern.slice(1))) {
				return true;
			}
		}

		return false;
	}
}
