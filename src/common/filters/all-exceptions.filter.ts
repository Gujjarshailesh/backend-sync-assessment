import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  MappingError,
  SourceUnavailableError,
  StaleCursorError,
} from '../errors/domain-errors';

/**
 * Consistent error shapes for every response, whether the failure came from
 * a controller-level HttpException, a domain error escaping an adapter, or
 * something truly unexpected - and makes sure a raw stack trace never
 * leaks to the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      response
        .status(status)
        .json(
          typeof body === 'string'
            ? { statusCode: status, message: body }
            : body,
        );
      return;
    }

    if (
      exception instanceof StaleCursorError ||
      exception instanceof SourceUnavailableError ||
      exception instanceof MappingError
    ) {
      this.logger.warn(
        `${exception.name} on ${request.method} ${request.url}: ${exception.message}`,
      );
      response.status(HttpStatus.BAD_GATEWAY).json({
        statusCode: HttpStatus.BAD_GATEWAY,
        error: exception.name,
        message: exception.message,
      });
      return;
    }

    const stack =
      exception instanceof Error ? exception.stack : String(exception);
    this.logger.error(
      `Unhandled exception on ${request.method} ${request.url}: ${stack}`,
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    });
  }
}
