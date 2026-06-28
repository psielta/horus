export class HorusWriteQueue {

	private current = Promise.resolve();
	private paused = false;
	private pausePromise: Promise<void> | undefined;
	private resumePause: (() => void) | undefined;

	enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const run = async () => {
			if (this.pausePromise) {
				await this.pausePromise;
			}

			return operation();
		};

		const result = this.current.then(run, run);
		this.current = result.then(() => undefined, () => undefined);
		return result;
	}

	pause(): void {
		if (this.paused) {
			return;
		}

		this.paused = true;
		this.pausePromise = new Promise<void>(resolve => {
			this.resumePause = resolve;
		});
	}

	resume(): void {
		if (!this.paused) {
			return;
		}

		this.paused = false;
		this.resumePause?.();
		this.resumePause = undefined;
		this.pausePromise = undefined;
	}

	async whenIdle(): Promise<void> {
		await this.current;
	}
}
