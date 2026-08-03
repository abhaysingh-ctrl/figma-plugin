/** Tracks a wall-clock deadline so discovery can stop early and still return partial results. */
export class DeadlineBudget {
  private readonly deadline: number

  constructor(budgetMs: number) {
    this.deadline = Date.now() + budgetMs
  }

  isExpired(): boolean {
    return Date.now() >= this.deadline
  }
}
