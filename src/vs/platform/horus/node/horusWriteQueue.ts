export class HorusWriteQueue {

	private current = Promise.resolve();
	private paused = false;

	enqueue<T>(operation: () => Promise<T>): Promise<T> {
		if (this.paused) {
			return Promise.reject(new Error('Horus write queue is paused'));
		}

		const run = async () => {
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
	}

	resume(): void {
		if (!this.paused) {
			return;
		}

		this.paused = false;
	}

	async whenIdle(): Promise<void> {
		await this.current;
	}
}
