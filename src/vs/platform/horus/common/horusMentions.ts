const plainFileMentionPattern = /(^|[\s([{"'])@["']?([^\s@]+)/g;
const trailingPathPunctuationPattern = /[)"',.;:!?]+$/;

export function extractHorusFileMentions(content: string): readonly string[] {
	const mentions = new Map<string, string>();

	for (const line of content.split(/\r?\n/g)) {
		plainFileMentionPattern.lastIndex = 0;

		let match: RegExpExecArray | null;
		while ((match = plainFileMentionPattern.exec(line)) !== null) {
			const rawPath = match[2]?.replace(trailingPathPunctuationPattern, '').replace(/^["']|["']$/g, '').trim();
			if (!rawPath || (!/[\\/]/.test(rawPath) && !/\.[^./\\]+$/.test(rawPath))) {
				continue;
			}

			const normalized = rawPath.replace(/\\/g, '/');
			mentions.set(normalized.toLowerCase(), normalized);
		}
	}

	return Array.from(mentions.values());
}
