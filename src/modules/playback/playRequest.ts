export interface PlayRequest {
    id: string;
    sourceIndex: number;
    restart?: boolean;
}

export function isPlayRequest(request: unknown): request is PlayRequest {
    if (typeof request !== 'object' || request === null) return false;
    const { id } = request as { id?: unknown };
    return typeof id === 'string' && id.trim() !== '';
}
