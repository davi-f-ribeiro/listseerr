export interface SkillResult<TData> {
  ok: boolean;
  data?: TData;
  error?: SkillError;
  meta?: SkillMeta;
}

export interface SkillError {
  code: string;
  message: string;
  retryable: boolean;
  origin: 'validation' | 'upstream' | 'internal' | 'timeout';
}

export interface SkillMeta {
  requiresFollowUp?: boolean;
  taskId?: string;
}
