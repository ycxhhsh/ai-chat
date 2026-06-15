export function shouldAppendStreamChunk(
    seenSeqByTask: Record<string, number>,
    taskId: unknown,
    seq: unknown,
): boolean {
    if (typeof taskId !== 'string' || !taskId) return true;
    const numericSeq = Number(seq);
    if (!Number.isFinite(numericSeq)) return true;

    const lastSeq = seenSeqByTask[taskId] ?? 0;
    if (numericSeq <= lastSeq) return false;
    seenSeqByTask[taskId] = numericSeq;
    return true;
}
