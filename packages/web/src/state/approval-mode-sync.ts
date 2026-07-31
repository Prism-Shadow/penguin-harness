/**
 * Orders approval-mode reads, writes, and SSE events without assigning timestamps
 * to the persisted setting. A response may update local state only while its
 * captured revision is still current.
 */
export class ApprovalModeSyncGuard {
  private revision = 0;

  snapshot(): number {
    return this.revision;
  }

  beginWrite(): number {
    this.revision += 1;
    return this.revision;
  }

  noteServerEvent(): void {
    this.revision += 1;
  }

  isCurrent(revision: number): boolean {
    return revision === this.revision;
  }
}
