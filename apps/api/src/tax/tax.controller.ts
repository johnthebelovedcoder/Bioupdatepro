import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { TaxType } from '@bioassetpro/database';
import { TaxEngineService } from './tax-engine.service';
import { TaxRegisterService } from './tax-register.service';
import { TaxPeriodService } from './tax-period.service';
import { kobo } from '../common/money';
import { CurrentCompany } from '../auth/current-user.decorator';
import { OwnedRecord } from '../auth/owned-record.guard';
import { Roles } from '../auth/roles.guard';

/** Consolidated Reference §4 API surface. */
@Controller('tax')
@Roles('FINANCE_MANAGER', 'FINANCIAL_CONTROLLER', 'MANAGING_DIRECTOR')
export class TaxController {
  constructor(
    private readonly engine: TaxEngineService,
    private readonly registers: TaxRegisterService,
    private readonly periods: TaxPeriodService,
  ) {}

  @Post('vat/calculate')
  async calculateVat(
    @CurrentCompany() companyId: string,
    @Body()
    body: {
      taxCode: string;
      amountKobo: string | number;
      on?: string;
    },
  ) {
    const result = await this.engine.calculateVat({
      companyId,
      taxCode: body.taxCode,
      amount: kobo(BigInt(body.amountKobo)),
      on: body.on ? new Date(body.on) : new Date(),
    });
    return serialiseVat(result);
  }

  @Post('vat/calculate-document')
  async calculateDocument(
    @CurrentCompany() companyId: string,
    @Body()
    body: {
      on?: string;
      lines: Array<{ lineNumber: number; taxCode: string; amountKobo: string | number }>;
    },
  ) {
    const result = await this.engine.calculateDocument({
      companyId,
      on: body.on ? new Date(body.on) : new Date(),
      lines: body.lines.map((l) => ({
        lineNumber: l.lineNumber,
        taxCode: l.taxCode,
        amount: kobo(BigInt(l.amountKobo)),
      })),
    });

    return {
      lines: result.lines.map((l) => ({ lineNumber: l.lineNumber, ...serialiseVat(l) })),
      totalTaxableBaseKobo: result.totalTaxableBaseKobo.toString(),
      totalTaxKobo: result.totalTaxKobo.toString(),
      totalGrossKobo: result.totalGrossKobo.toString(),
    };
  }

  @Post('wht/calculate')
  async calculateWht(
    @CurrentCompany() companyId: string,
    @Body()
    body: {
      taxCode: string;
      amountKobo: string | number;
      vatAmountKobo?: string | number;
      on?: string;
    },
  ) {
    const result = await this.engine.calculateWht({
      companyId,
      taxCode: body.taxCode,
      amount: kobo(BigInt(body.amountKobo)),
      vatAmount:
        body.vatAmountKobo !== undefined ? kobo(BigInt(body.vatAmountKobo)) : undefined,
      on: body.on ? new Date(body.on) : new Date(),
    });

    return {
      taxCode: result.taxCode,
      whtCategory: result.whtCategory,
      appliedRate: result.appliedRate,
      taxableBaseKobo: result.taxableBaseKobo.toString(),
      taxKobo: result.taxKobo.toString(),
      netPayableKobo: result.netPayableKobo.toString(),
      explanation: result.explanation,
    };
  }

  @Get('vat/register')
  async vatRegister(
    @CurrentCompany() companyId: string,
    @Query('taxPeriodId') taxPeriodId: string,
  ) {
    const result = await this.registers.vatRegister(companyId, taxPeriodId);
    return {
      summary: result.summary,
      entries: result.entries.map((e) => ({
        documentDate: e.documentDate,
        documentReference: e.documentReference,
        direction: e.direction,
        treatment: e.treatment,
        taxCode: e.taxCode.code,
        counterparty: e.counterpartyName,
        counterpartyTin: e.counterpartyTin,
        taxableBaseKobo: e.taxableBaseKobo.toString(),
        taxKobo: e.taxKobo.toString(),
        appliedRate: e.appliedRate.toString(),
        recoverable: e.recoverable,
        journalEntryId: e.journalEntryId,
      })),
    };
  }

  @Get('wht/register')
  async whtRegister(
    @CurrentCompany() companyId: string,
    @Query('taxPeriodId') taxPeriodId: string,
  ) {
    const result = await this.registers.whtRegister(companyId, taxPeriodId);
    return {
      summary: result.summary,
      entries: result.entries.map((e) => ({
        documentDate: e.documentDate,
        documentReference: e.documentReference,
        direction: e.direction,
        whtCategory: e.whtCategory,
        taxCode: e.taxCode.code,
        counterparty: e.counterpartyName,
        counterpartyTin: e.counterpartyTin,
        grossAmountKobo: e.grossAmountKobo.toString(),
        taxableBaseKobo: e.taxableBaseKobo.toString(),
        taxKobo: e.taxKobo.toString(),
        appliedRate: e.appliedRate.toString(),
        creditNoteReference: e.creditNoteReference,
        journalEntryId: e.journalEntryId,
      })),
    };
  }

  @Get('reconciliation')
  async reconciliation(
    @CurrentCompany() companyId: string,
    @Query('taxPeriodId') taxPeriodId: string,
  ) {
    return this.registers.reconcile(companyId, taxPeriodId);
  }

  @Get('periods')
  async listPeriods(
    @CurrentCompany() companyId: string,
    @Query('taxType') taxType?: TaxType,
  ) {
    return this.periods.list(companyId, taxType);
  }

  @Post('periods/generate')
  async generatePeriods(
    @Body()
    body: { companyId: string; taxType: TaxType; year: number; actorId: string },
  ) {
    return this.periods.generateYear(body);
  }

  @OwnedRecord('taxPeriod', 'id')
  @Post('periods/:id/close')
  async closePeriod(@Param('id') id: string, @Body() body: { actorId: string }) {
    return this.periods.close({ taxPeriodId: id, actorId: body.actorId });
  }

  @OwnedRecord('taxPeriod', 'id')
  @Post('periods/:id/file')
  async filePeriod(
    @Param('id') id: string,
    @Body() body: { actorId: string; filingReference: string },
  ) {
    return this.periods.markFiled({
      taxPeriodId: id,
      actorId: body.actorId,
      filingReference: body.filingReference,
    });
  }
}

function serialiseVat(result: {
  taxCode: string;
  treatment: string;
  recoverable: boolean;
  appliedRate: string;
  taxableBaseKobo: bigint;
  taxKobo: bigint;
  grossKobo: bigint;
  explanation: string;
}) {
  return {
    taxCode: result.taxCode,
    treatment: result.treatment,
    recoverable: result.recoverable,
    appliedRate: result.appliedRate,
    taxableBaseKobo: result.taxableBaseKobo.toString(),
    taxKobo: result.taxKobo.toString(),
    grossKobo: result.grossKobo.toString(),
    explanation: result.explanation,
  };
}
