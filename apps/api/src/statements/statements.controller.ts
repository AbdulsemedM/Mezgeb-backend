import { Controller, Get, Header, Query, StreamableFile } from '@nestjs/common';
import { type StatementQuery, statementQuerySchema } from '@mezgeb/shared';
import { AccountActionRequired, CurrentAccountAccess } from '../access/access.guards.js';
import type { AccountAccess } from '../access/access.service.js';
import { CurrentAuth } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/token.service.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { StatementsService } from './statements.service.js';

@Controller('accounts')
export class StatementsController {
  constructor(private readonly statements: StatementsService) {}

  /** LED-7 / US-14: owner and customer (ADR-003), online only. */
  @Get(':id/statement.pdf')
  @AccountActionRequired('view_statement')
  @Header('Content-Type', 'application/pdf')
  async pdf(
    @CurrentAccountAccess() a: AccountAccess,
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(statementQuerySchema)) q: StatementQuery,
  ): Promise<StreamableFile> {
    const pdf = await this.statements.pdf(a, auth.userId, q.from, q.to);
    return new StreamableFile(pdf, {
      disposition: `attachment; filename="mezgeb-statement-${q.from}-${q.to}.pdf"`,
    });
  }
}
