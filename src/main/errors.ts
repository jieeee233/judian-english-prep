import type { ErrorCode, Failure } from '../shared/types';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status?: number;

  constructor(code: ErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
  }
}

export function fail(code: ErrorCode, message: string, status?: number): Failure {
  return status === undefined ? { ok: false, code, message } : { ok: false, code, message, status };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 把 HTTP 状态码翻译成教师能直接照着处理的中文提示。 */
export function mapHttpStatus(status: number): AppError {
  if (status === 401) {
    return new AppError('AUTH', '密钥无效或已失效（HTTP 401），请在 API 设置中重新输入。', status);
  }
  if (status === 402) {
    return new AppError('BALANCE', '服务账户余额或配额不足，请到服务商控制台检查后再重试。', status);
  }
  if (status === 403) {
    return new AppError(
      'FORBIDDEN',
      '服务拒绝访问（HTTP 403），请检查账户权限、实名认证或模型访问权限。',
      status,
    );
  }
  if (status === 404) {
    return new AppError(
      'MODEL',
      '模型或接口不存在，请检查基础地址与模型标识，确认账户可使用所选模型。',
      status,
    );
  }
  if (status === 429) {
    return new AppError(
      'RATE_LIMIT',
      '服务请求或 token 速率受限（HTTP 429），请稍后手动重试，或缩短文章。',
      status,
    );
  }
  if (status === 408 || status === 504) {
    return new AppError('TIMEOUT', '服务端处理超时，请稍后重试或缩短文章；本地没有自动重试。', status);
  }
  if (status >= 500) {
    return new AppError('SERVER', `模型服务暂时不可用（HTTP ${status}），请稍后手动重试。`, status);
  }
  if (status >= 300 && status < 400) {
    return new AppError('HTTP', '接口要求跳转，已拒绝转发密钥；请检查基础地址。', status);
  }
  return new AppError(
    'HTTP',
    `请求被服务拒绝（HTTP ${status}），请检查模型、输入长度与接口参数；没有自动重试。`,
    status,
  );
}

export function messageOf(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: { code?: string } }).cause;
    return `${error.message} ${cause && typeof cause.code === 'string' ? cause.code : ''}`.trim();
  }
  return '';
}
