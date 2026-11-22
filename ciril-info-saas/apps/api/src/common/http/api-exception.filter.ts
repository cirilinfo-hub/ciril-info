import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Prisma } from '../../generated/prisma/client.js';

/** Error envelope returned by every endpoint: { error: { code, message, details?, requestId } } */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  422: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
};

/**
 * Converts every thrown error into the standard envelope. Database and
 * unexpected errors are logged in full server-side but the client only ever
 * sees a generic message plus the request id (rule: never expose DB errors).
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    const requestId = req.id ? String(req.id) : undefined;

    const { status, body } = this.toResponse(exception);
    body.error.requestId = requestId;

    if (status >= 500) {
      this.log.error(
        { err: exception, requestId, path: req.originalUrl, method: req.method },
        'Unhandled error',
      );
    }
    res.status(status).json(body);
  }

  private toResponse(exception: unknown): { status: number; body: ApiErrorBody } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const resp = exception.getResponse();
      let message = exception.message;
      let details: unknown;
      let code = STATUS_CODES[status] ?? 'ERROR';
      if (typeof resp === 'object' && resp !== null) {
        const r = resp as Record<string, unknown>;
        if (typeof r['code'] === 'string') code = r['code'];
        if (Array.isArray(r['message'])) {
          // class-validator output
          code = 'VALIDATION_FAILED';
          message = 'Some fields are invalid.';
          details = r['message'];
        } else if (typeof r['message'] === 'string') {
          message = r['message'];
        }
        if (r['details'] !== undefined) details = r['details'];
      }
      return { status, body: { error: { code, message, details } } };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          return { status: HttpStatus.CONFLICT, body: { error: { code: 'CONFLICT', message: 'This record already exists.' } } };
        case 'P2025':
          return { status: HttpStatus.NOT_FOUND, body: { error: { code: 'NOT_FOUND', message: 'Record not found.' } } };
        case 'P2003':
          return { status: HttpStatus.CONFLICT, body: { error: { code: 'CONFLICT', message: 'This record is referenced by other data.' } } };
      }
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } },
    };
  }
}
