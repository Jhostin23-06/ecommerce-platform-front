import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import PDFDocument = require('pdfkit');
import { UserRole } from '../auth/enums/user-role.enum';
import { User } from '../auth/user.entity';
import { Order, OrderStatus } from '../orders/order.entity';
import { Tenant } from '../tenants/tenant.entity';
import { BillingSettingsQueryDto } from './dto/billing-settings-query.dto';
import { UpdateBillingSettingsDto } from './dto/update-billing-settings.dto';
import {
  BillingDocument,
  BillingDocumentKind,
  BillingDocumentStatus,
} from './entities/billing-document.entity';
import {
  BillingEnvironment,
  BillingProvider,
  BillingSettings,
} from './entities/billing-settings.entity';

type Actor = {
  userId: string;
  role: UserRole;
  tenantId: string | null;
  email: string;
};

type ProviderEmitResult = {
  accepted: boolean;
  externalId: string | null;
  pdfUrl: string | null;
  providerResponse: Record<string, unknown> | null;
  errorMessage: string | null;
};

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly igvRate = 0.18;

  constructor(
    @InjectRepository(BillingSettings)
    private readonly settingsRepository: Repository<BillingSettings>,
    @InjectRepository(BillingDocument)
    private readonly documentsRepository: Repository<BillingDocument>,
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Tenant)
    private readonly tenantsRepository: Repository<Tenant>,
    private readonly configService: ConfigService,
  ) {}

  async getSettings(query: BillingSettingsQueryDto, actor: Actor): Promise<Record<string, unknown>> {
    const tenantId = await this.resolveTargetTenantId(query.tenantId, actor);
    const settings = await this.loadSettingsWithToken(tenantId);
    return this.sanitizeSettings(settings);
  }

  async upsertSettings(
    query: BillingSettingsQueryDto,
    payload: UpdateBillingSettingsDto,
    actor: Actor,
  ): Promise<Record<string, unknown>> {
    const tenantId = await this.resolveTargetTenantId(query.tenantId, actor);
    const existing = await this.loadSettingsWithToken(tenantId);

    const provider = payload.provider ?? existing?.provider ?? BillingProvider.DEMO;
    const environment = payload.environment ?? existing?.environment ?? BillingEnvironment.DEMO;
    const defaultInvoiceSeries =
      provider === BillingProvider.NUBEFACT && environment === BillingEnvironment.DEMO ? 'FFF1' : 'F001';
    const defaultReceiptSeries =
      provider === BillingProvider.NUBEFACT && environment === BillingEnvironment.DEMO ? 'BBB1' : 'B001';
    const nextSettings = this.settingsRepository.create({
      id: existing?.id,
      tenantId,
      provider,
      environment,
      isActive: payload.isActive ?? existing?.isActive ?? false,
      issuerRuc: this.normalizeOptionalString(payload.issuerRuc) ?? existing?.issuerRuc ?? null,
      issuerBusinessName:
        this.normalizeOptionalString(payload.issuerBusinessName) ?? existing?.issuerBusinessName ?? null,
      issuerAddress: this.normalizeOptionalString(payload.issuerAddress) ?? existing?.issuerAddress ?? null,
      invoiceSeries:
        this.normalizeOptionalString(payload.invoiceSeries) ??
        existing?.invoiceSeries ??
        defaultInvoiceSeries,
      receiptSeries:
        this.normalizeOptionalString(payload.receiptSeries) ??
        existing?.receiptSeries ??
        defaultReceiptSeries,
      creditNoteSeries:
        this.normalizeOptionalString(payload.creditNoteSeries) ??
        existing?.creditNoteSeries ??
        'FC01',
      apiBaseUrl:
        this.normalizeOptionalString(payload.apiBaseUrl) ?? existing?.apiBaseUrl ?? null,
      apiToken:
        payload.apiToken !== undefined
          ? this.normalizeOptionalString(payload.apiToken)
          : (existing?.apiToken ?? null),
      extraConfig: payload.extraConfig ?? existing?.extraConfig ?? null,
    });

    this.assertSettingsConsistency(nextSettings);
    const saved = await this.settingsRepository.save(nextSettings);
    return this.sanitizeSettings(saved);
  }

  async listOrderDocuments(orderId: string, actor: Actor): Promise<BillingDocument[]> {
    const order = await this.ordersRepository.findOne({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException('Orden no encontrada');
    }
    this.assertOrderAccess(order, actor);

    const documents = await this.documentsRepository.find({
      where: { orderId: order.id },
      order: { createdAt: 'DESC' },
    });
    return documents.map((entry) => this.decorateBillingDocument(entry));
  }

  async getLatestOrderDocumentLink(
    orderId: string,
    actor: Actor,
  ): Promise<{ documentNumber: string; pdfUrl: string | null }> {
    const order = await this.ordersRepository.findOne({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException('Orden no encontrada');
    }
    this.assertOrderAccess(order, actor);

    const latestDocument = await this.documentsRepository.findOne({
      where: {
        orderId: order.id,
        status: BillingDocumentStatus.ISSUED,
        kind: In([BillingDocumentKind.RECEIPT, BillingDocumentKind.INVOICE, BillingDocumentKind.CREDIT_NOTE]),
      },
      order: { createdAt: 'DESC' },
    });
    if (!latestDocument) {
      throw new NotFoundException('No existe comprobante emitido para esta orden');
    }

    return {
      documentNumber: latestDocument.documentNumber,
      pdfUrl: this.extractProviderPdfUrl(latestDocument.providerResponse),
    };
  }

  async getLatestOrderDocumentPdf(
    orderId: string,
    actor: Actor,
  ): Promise<{ fileName: string; content: Buffer }> {
    const order = await this.ordersRepository.findOne({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException('Orden no encontrada');
    }
    this.assertOrderAccess(order, actor);

    const latestDocument = await this.documentsRepository.findOne({
      where: {
        orderId: order.id,
        status: BillingDocumentStatus.ISSUED,
        kind: In([BillingDocumentKind.RECEIPT, BillingDocumentKind.INVOICE, BillingDocumentKind.CREDIT_NOTE]),
      },
      order: { createdAt: 'DESC' },
    });
    if (!latestDocument) {
      throw new NotFoundException('No existe comprobante emitido para esta orden');
    }

    const providerPdfUrl = this.extractProviderPdfUrl(latestDocument.providerResponse);
    if (providerPdfUrl) {
      try {
        const officialPdfResponse = await fetch(providerPdfUrl, {
          method: 'GET',
        });

        if (officialPdfResponse.ok) {
          const arrayBuffer = await officialPdfResponse.arrayBuffer();
          return {
            fileName: `${latestDocument.documentNumber}.pdf`,
            content: Buffer.from(arrayBuffer),
          };
        }

        this.logger.warn(
          `No se pudo descargar PDF oficial (${officialPdfResponse.status}) para ${latestDocument.documentNumber}. Se usara fallback local.`,
        );
      } catch (error) {
        this.logger.warn(
          `Fallo descarga de PDF oficial para ${latestDocument.documentNumber}: ${(error as Error).message}`,
        );
      }
    }

    const content = await this.renderBillingDocumentPdf(latestDocument, order);
    const fileName = `${latestDocument.documentNumber}.pdf`;

    return {
      fileName,
      content,
    };
  }

  async issueDocumentForPaidOrder(orderId: string, trigger = 'system'): Promise<BillingDocument | null> {
    const order = await this.ordersRepository.findOne({ where: { id: orderId } });
    if (!order || order.status !== OrderStatus.PAID) {
      return null;
    }

    const settings = await this.loadActiveSettings(order.tenantId);
    if (!settings) {
      return null;
    }

    const documentKind =
      order.billingDetails?.documentType === 'invoice'
        ? BillingDocumentKind.INVOICE
        : BillingDocumentKind.RECEIPT;
    const existing = await this.documentsRepository.findOne({
      where: {
        orderId: order.id,
        kind: documentKind,
      },
      order: { createdAt: 'DESC' },
    });
    if (existing && existing.status === BillingDocumentStatus.ISSUED) {
      return this.decorateBillingDocument(existing);
    }

    const issueDate = new Date();
    const customer = await this.resolveOrderCustomerData(order);
    this.assertCustomerDataReadyForEmission(documentKind, customer);
    const shouldCreateReplacementDocument = this.shouldCreateReplacementDocument(existing, customer, trigger);
    if (!shouldCreateReplacementDocument) {
      this.assertExistingDocumentCanBeRetried(existing, customer);
    }
    const series =
      documentKind === BillingDocumentKind.INVOICE
        ? settings.invoiceSeries
        : settings.receiptSeries;
    const number =
      existing && !shouldCreateReplacementDocument
        ? existing.number
        : await this.nextCorrelative(order.tenantId, series, documentKind);
    const documentNumber = `${series}-${number.toString().padStart(8, '0')}`;
    const totals = this.resolveTotals(order.total);
    const providerPayload = this.buildProviderPayload({
      settings,
      order,
      kind: documentKind,
      issueDate,
      series,
      number,
      documentNumber,
      totals,
      customer,
      trigger,
      reason: null,
      relatedDocumentNumber: null,
    });

    const emitted = await this.emitWithProvider(settings, providerPayload);
    const document = this.documentsRepository.create({
      id: existing && !shouldCreateReplacementDocument ? existing.id : undefined,
      tenantId: order.tenantId,
      orderId: order.id,
      refundId: null,
      provider: settings.provider,
      environment: settings.environment,
      kind: documentKind,
      status: emitted.accepted ? BillingDocumentStatus.ISSUED : BillingDocumentStatus.FAILED,
      series,
      number,
      documentNumber,
      externalId: emitted.externalId,
      issueDate,
      currency: order.currency,
      subtotal: this.toMoney(totals.subtotal),
      taxTotal: this.toMoney(totals.taxTotal),
      total: this.toMoney(totals.total),
      customerName: customer.customerName,
      customerDocumentType: customer.customerDocumentType,
      customerDocumentNumber: customer.customerDocumentNumber,
      requestPayload: providerPayload,
      providerResponse: emitted.providerResponse,
      errorMessage: emitted.errorMessage,
    });
    const saved = await this.documentsRepository.save(document);
    return this.decorateBillingDocument(saved);
  }

  async issueCreditNoteForRefund(payload: {
    tenantId: string;
    orderId: string;
    refundId: string;
    amount: string;
    currency: string;
    reason: string | null;
    trigger?: string;
  }): Promise<BillingDocument | null> {
    const settings = await this.loadActiveSettings(payload.tenantId);
    if (!settings) {
      return null;
    }

    const existingByRefund = await this.documentsRepository.findOne({
      where: { refundId: payload.refundId },
    });
    if (existingByRefund && existingByRefund.status === BillingDocumentStatus.ISSUED) {
      return this.decorateBillingDocument(existingByRefund);
    }

    const order = await this.ordersRepository.findOne({ where: { id: payload.orderId } });
    if (!order) {
      throw new NotFoundException('Orden no encontrada');
    }

    const relatedDocument = await this.documentsRepository.findOne({
      where: {
        orderId: order.id,
        kind: In([BillingDocumentKind.RECEIPT, BillingDocumentKind.INVOICE]),
        status: BillingDocumentStatus.ISSUED,
      },
      order: { createdAt: 'DESC' },
    });
    if (!relatedDocument) {
      throw new ConflictException('No existe comprobante emitido para generar nota de credito');
    }

    const issueDate = new Date();
    const series = settings.creditNoteSeries;
    const number =
      existingByRefund?.number ??
      (await this.nextCorrelative(order.tenantId, series, BillingDocumentKind.CREDIT_NOTE));
    const documentNumber = `${series}-${number.toString().padStart(8, '0')}`;
    const totalAmount = Number(payload.amount);
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      throw new ConflictException('Monto invalido para nota de credito');
    }

    const totals = this.resolveTotals(this.toMoney(totalAmount));
    const customer = await this.resolveOrderCustomerData(order);
    const providerPayload = this.buildProviderPayload({
      settings,
      order,
      kind: BillingDocumentKind.CREDIT_NOTE,
      issueDate,
      series,
      number,
      documentNumber,
      totals,
      customer,
      trigger: payload.trigger ?? 'refund',
      reason: payload.reason,
      relatedDocumentNumber: relatedDocument.documentNumber,
      relatedDocumentKind: relatedDocument.kind,
    });
    const emitted = await this.emitWithProvider(settings, providerPayload);

    const document = this.documentsRepository.create({
      id: existingByRefund?.id,
      tenantId: order.tenantId,
      orderId: order.id,
      refundId: payload.refundId,
      provider: settings.provider,
      environment: settings.environment,
      kind: BillingDocumentKind.CREDIT_NOTE,
      status: emitted.accepted ? BillingDocumentStatus.ISSUED : BillingDocumentStatus.FAILED,
      series,
      number,
      documentNumber,
      externalId: emitted.externalId,
      issueDate,
      currency: payload.currency,
      subtotal: this.toMoney(totals.subtotal),
      taxTotal: this.toMoney(totals.taxTotal),
      total: this.toMoney(totals.total),
      customerName: customer.customerName,
      customerDocumentType: customer.customerDocumentType,
      customerDocumentNumber: customer.customerDocumentNumber,
      requestPayload: providerPayload,
      providerResponse: emitted.providerResponse,
      errorMessage: emitted.errorMessage,
    });
    const saved = await this.documentsRepository.save(document);
    return this.decorateBillingDocument(saved);
  }

  private async emitWithProvider(
    settings: BillingSettings,
    payload: Record<string, unknown>,
  ): Promise<ProviderEmitResult> {
    if (settings.provider === BillingProvider.DEMO) {
      return {
        accepted: true,
        externalId: `demo-${Date.now()}`,
        pdfUrl: null,
        providerResponse: {
          mode: 'demo',
          accepted: true,
          payload,
        },
        errorMessage: null,
      };
    }

    const endpoint =
      settings.apiBaseUrl ||
      (this.configService.get<string>('BILLING_NUBEFACT_API_URL_TEMPLATE') ?? '')
        .replace('{ruc}', settings.issuerRuc ?? '');
    if (!endpoint) {
      throw new ConflictException('Falta apiBaseUrl para el proveedor de facturacion');
    }

    const token = settings.apiToken || this.configService.get<string>('BILLING_NUBEFACT_API_TOKEN') || null;
    if (!token) {
      throw new ConflictException('Falta apiToken para el proveedor de facturacion');
    }

    const authFormat =
      this.configService.get<string>('BILLING_NUBEFACT_AUTH_FORMAT') ?? 'Token token="{token}"';
    const authorization = authFormat.replace('{token}', token);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: authorization,
      },
      body: JSON.stringify(payload),
    });
    const responseText = await response.text();
    const responseJson = this.tryParseJson(responseText);
    const errorMessage = this.extractProviderError(responseJson, response.ok, responseText);
    const accepted = response.ok && !errorMessage;

    const externalId = this.extractProviderExternalId(responseJson);
    const pdfUrl = this.extractProviderPdfUrl(responseJson);
    return {
      accepted,
      externalId,
      pdfUrl,
      providerResponse: responseJson,
      errorMessage,
    };
  }

  private extractProviderError(
    providerResponse: Record<string, unknown> | null,
    responseOk: boolean,
    fallback: string,
  ): string | null {
    if (providerResponse) {
      const errors = providerResponse.errors;
      if (typeof errors === 'string' && errors.trim().length) {
        return errors;
      }
      if (Array.isArray(errors) && errors.length) {
        return errors
          .map((entry) => (typeof entry === 'string' ? entry : JSON.stringify(entry)))
          .join('; ');
      }

      const message = providerResponse.mensaje;
      if (!responseOk && typeof message === 'string' && message.trim().length) {
        return message;
      }
    }

    if (!responseOk) {
      return fallback.slice(0, 500) || 'Proveedor de facturacion rechazo la solicitud';
    }

    return null;
  }

  private extractProviderExternalId(providerResponse: Record<string, unknown> | null): string | null {
    if (!providerResponse) {
      return null;
    }

    const externalId = providerResponse.external_id;
    if (typeof externalId === 'string' && externalId.trim().length) {
      return externalId.trim();
    }

    const enlace = providerResponse.enlace;
    if (typeof enlace === 'string' && enlace.trim().length) {
      return enlace.trim();
    }

    const serie = providerResponse.serie;
    const numero = providerResponse.numero;
    if (typeof serie === 'string' && (typeof numero === 'string' || typeof numero === 'number')) {
      return `${serie}-${numero}`;
    }

    return null;
  }

  private extractProviderPdfUrl(providerResponse: Record<string, unknown> | null): string | null {
    if (!providerResponse) {
      return null;
    }

    const directCandidates = [
      providerResponse.pdf,
      providerResponse.pdf_url,
      providerResponse.enlace_pdf,
      providerResponse.enlace_del_pdf,
      providerResponse.url_pdf,
      providerResponse.url_del_pdf,
      providerResponse.enlace_para_pdf,
    ];
    for (const candidate of directCandidates) {
      if (typeof candidate === 'string' && this.isHttpUrl(candidate)) {
        return candidate.trim();
      }
    }

    const nestedCandidates = [
      providerResponse.enlaces,
      providerResponse.links,
      providerResponse.data,
      providerResponse.resultado,
      providerResponse.comprobante,
    ];
    for (const nested of nestedCandidates) {
      if (!nested || typeof nested !== 'object') {
        continue;
      }
      const nestedRecord = nested as Record<string, unknown>;
      for (const [key, value] of Object.entries(nestedRecord)) {
        if (typeof value === 'string' && key.toLowerCase().includes('pdf') && this.isHttpUrl(value)) {
          return value.trim();
        }
      }
    }

    for (const [key, value] of Object.entries(providerResponse)) {
      if (typeof value === 'string' && key.toLowerCase().includes('pdf') && this.isHttpUrl(value)) {
        return value.trim();
      }
    }

    return null;
  }

  private buildProviderPayload(input: {
    settings: BillingSettings;
    order: Order;
    kind: BillingDocumentKind;
    issueDate: Date;
    series: string;
    number: number;
    documentNumber: string;
    totals: { subtotal: number; taxTotal: number; total: number };
    customer: { customerName: string; customerDocumentType: string; customerDocumentNumber: string; customerAddress: string | null };
    trigger: string;
    reason: string | null;
    relatedDocumentNumber: string | null;
    relatedDocumentKind?: BillingDocumentKind;
  }): Record<string, unknown> {
    if (input.settings.provider === BillingProvider.NUBEFACT) {
      const [referenceSeries, referenceNumber] = (input.relatedDocumentNumber ?? '-').split('-');
      const basePayload: Record<string, unknown> = {
        operacion:
          input.kind === BillingDocumentKind.CREDIT_NOTE
            ? 'generar_nota_de_credito'
            : 'generar_comprobante',
        tipo_de_comprobante:
          input.kind === BillingDocumentKind.INVOICE
            ? 1
            : input.kind === BillingDocumentKind.RECEIPT
              ? 2
              : 3,
        serie: input.series,
        numero: input.number,
        fecha_de_emision: this.toDayMonthYear(input.issueDate),
        moneda: input.order.currency.toUpperCase() === 'USD' ? '2' : '1',
        cliente_tipo_de_documento: this.mapCustomerDocumentType(input.customer.customerDocumentType),
        cliente_numero_de_documento: input.customer.customerDocumentNumber,
        cliente_denominacion: input.customer.customerName,
        cliente_direccion: input.customer.customerAddress ?? '-',
        total_gravada: this.toMoney(input.totals.subtotal),
        total_igv: this.toMoney(input.totals.taxTotal),
        total: this.toMoney(input.totals.total),
        porcentaje_de_igv: this.toMoney(this.igvRate * 100),
        observaciones: `source=${input.trigger}`,
      };

      if (input.kind === BillingDocumentKind.CREDIT_NOTE) {
        basePayload.tipo_de_nota_de_credito = '01';
        basePayload.tipo_de_comprobante_referencia =
          input.relatedDocumentKind === BillingDocumentKind.INVOICE ? 1 : 2;
        basePayload.serie_comprobante = referenceSeries ?? '';
        basePayload.numero_comprobante = referenceNumber ?? '';
        basePayload.motivo = input.reason ?? 'Anulacion de la operacion';
      }

      basePayload.items = this.buildNubefactItems(input);

      return basePayload;
    }

    return {
      provider: input.settings.provider,
      environment: input.settings.environment,
      kind: input.kind,
      issueDate: input.issueDate.toISOString(),
      documentNumber: input.documentNumber,
      customer: input.customer,
      totals: {
        subtotal: this.toMoney(input.totals.subtotal),
        taxTotal: this.toMoney(input.totals.taxTotal),
        total: this.toMoney(input.totals.total),
      },
      items: input.order.items.map((item) => ({
        productId: item.productId,
        sku: item.sku,
        name: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
      })),
      relatedDocumentNumber: input.relatedDocumentNumber,
      reason: input.reason,
      trigger: input.trigger,
    };
  }

  private async resolveOrderCustomerData(order: Order): Promise<{
    customerName: string;
    customerDocumentType: string;
    customerDocumentNumber: string;
    customerAddress: string | null;
  }> {
    const user = await this.usersRepository.findOne({
      where: { id: order.userId },
      select: ['id', 'fullName', 'email'],
    });

    const customerName =
      order.billingDetails?.customerName ||
      order.deliveryAddress?.fullName ||
      user?.fullName ||
      'Cliente';
    const customerDocumentType = (order.billingDetails?.customerDocumentType || 'DNI').toUpperCase();
    const customerDocumentNumber =
      order.billingDetails?.customerDocumentNumber || '00000000';
    const customerAddress =
      order.billingDetails?.customerAddress ||
      order.deliveryAddress?.line1 ||
      null;

    return {
      customerName,
      customerDocumentType,
      customerDocumentNumber,
      customerAddress,
    };
  }

  private assertCustomerDataReadyForEmission(
    kind: BillingDocumentKind,
    customer: {
      customerName: string;
      customerDocumentType: string;
      customerDocumentNumber: string;
      customerAddress: string | null;
    },
  ): void {
    const documentType = customer.customerDocumentType.trim().toUpperCase();
    const documentNumber = customer.customerDocumentNumber.trim();
    const unsupportedDocument = this.mapCustomerDocumentType(documentType) === '0';

    if (!documentNumber.length || this.isPlaceholderCustomerDocument(documentNumber)) {
      throw new ConflictException(
        'No se puede emitir el comprobante sin un documento del cliente valido. Actualiza los datos de facturacion de la orden antes de emitir.',
      );
    }

    if (unsupportedDocument) {
      throw new ConflictException(`El tipo de documento ${documentType} no es compatible con la emision del comprobante.`);
    }

    if (documentType === 'DNI' && !/^\d{8}$/.test(documentNumber)) {
      throw new ConflictException('Para boleta con DNI, el documento del cliente debe tener 8 digitos.');
    }

    if (documentType === 'RUC' && !/^\d{11}$/.test(documentNumber)) {
      throw new ConflictException('Para comprobantes con RUC, el documento del cliente debe tener 11 digitos.');
    }

    if (kind === BillingDocumentKind.INVOICE) {
      if (documentType !== 'RUC') {
        throw new ConflictException('No se puede emitir factura si el cliente no tiene RUC.');
      }
      if (!customer.customerAddress?.trim()) {
        throw new ConflictException('No se puede emitir factura sin direccion fiscal del cliente.');
      }
    }
  }

  private assertExistingDocumentCanBeRetried(
    existing: BillingDocument | null,
    customer: {
      customerName: string;
      customerDocumentType: string;
      customerDocumentNumber: string;
      customerAddress: string | null;
    },
  ): void {
    if (!existing || existing.status === BillingDocumentStatus.ISSUED) {
      return;
    }

    if (this.isProviderDuplicateDocumentError(existing)) {
      throw new ConflictException(
        `El comprobante ${existing.documentNumber} ya existe en NubeFact. Revisa ese correlativo antes de volver a emitir.`,
      );
    }

    const previousDocumentType = existing.customerDocumentType?.trim().toUpperCase() ?? '';
    const previousDocumentNumber = existing.customerDocumentNumber?.trim() ?? '';
    const previousCustomerName = existing.customerName?.trim() ?? '';
    const nextDocumentType = customer.customerDocumentType.trim().toUpperCase();
    const nextDocumentNumber = customer.customerDocumentNumber.trim();
    const nextCustomerName = customer.customerName.trim();

    if (
      previousDocumentType !== nextDocumentType ||
      previousDocumentNumber !== nextDocumentNumber ||
      previousCustomerName !== nextCustomerName
    ) {
      throw new ConflictException(
        `El comprobante ${existing.documentNumber} ya fue intentado con otros datos del cliente. No se puede reutilizar ese correlativo con una identidad distinta.`,
      );
    }
  }

  private shouldCreateReplacementDocument(
    existing: BillingDocument | null,
    customer: {
      customerName: string;
      customerDocumentType: string;
      customerDocumentNumber: string;
      customerAddress: string | null;
    },
    trigger: string,
  ): boolean {
    if (!existing || existing.status === BillingDocumentStatus.ISSUED || !this.isManualBillingTrigger(trigger)) {
      return false;
    }

    if (this.isProviderDuplicateDocumentError(existing)) {
      return true;
    }

    const previousDocumentType = existing.customerDocumentType?.trim().toUpperCase() ?? '';
    const previousDocumentNumber = existing.customerDocumentNumber?.trim() ?? '';
    const previousCustomerName = existing.customerName?.trim() ?? '';
    const nextDocumentType = customer.customerDocumentType.trim().toUpperCase();
    const nextDocumentNumber = customer.customerDocumentNumber.trim();
    const nextCustomerName = customer.customerName.trim();

    return (
      previousDocumentType !== nextDocumentType ||
      previousDocumentNumber !== nextDocumentNumber ||
      previousCustomerName !== nextCustomerName
    );
  }

  private isPlaceholderCustomerDocument(value: string): boolean {
    return /^0+$/.test(value.trim());
  }

  private isManualBillingTrigger(trigger: string): boolean {
    return trigger.trim().toLowerCase() === 'manual';
  }

  private isProviderDuplicateDocumentError(document: BillingDocument): boolean {
    const response = document.providerResponse;
    if (response && typeof response === 'object') {
      const code = (response as Record<string, unknown>).codigo;
      if (code === 23 || code === '23') {
        return true;
      }

      const errors = (response as Record<string, unknown>).errors;
      if (typeof errors === 'string' && errors.toLowerCase().includes('ya existe')) {
        return true;
      }
    }

    return typeof document.errorMessage === 'string' && document.errorMessage.toLowerCase().includes('ya existe');
  }

  private resolveTotals(orderTotal: string): { subtotal: number; taxTotal: number; total: number } {
    const total = Number(orderTotal);
    const subtotal = Number((total / (1 + this.igvRate)).toFixed(2));
    const taxTotal = Number((total - subtotal).toFixed(2));
    return {
      subtotal,
      taxTotal,
      total,
    };
  }

  private buildNubefactItems(input: {
    order: Order;
    kind: BillingDocumentKind;
    totals: { subtotal: number; taxTotal: number; total: number };
  }): Array<Record<string, unknown>> {
    const targetSubtotal = this.toMoneyNumber(input.totals.subtotal);
    const targetTotal = this.toMoneyNumber(input.totals.total);

    if (targetTotal <= 0) {
      return [];
    }

    if (input.kind === BillingDocumentKind.CREDIT_NOTE) {
      const subtotal = targetSubtotal;
      const total = targetTotal;
      const igv = this.toMoneyNumber(total - subtotal);
      return [
        {
          unidad_de_medida: 'NIU',
          codigo: 'CREDIT_NOTE',
          descripcion: `Devolucion de pedido ${input.order.id.slice(0, 8)}`,
          cantidad: 1,
          valor_unitario: this.toMoney(subtotal),
          precio_unitario: this.toMoney(total),
          subtotal: this.toMoney(subtotal),
          tipo_de_igv: 1,
          igv: this.toMoney(igv),
          total: this.toMoney(total),
          anticipo_regularizacion: false,
        },
      ];
    }

    const baseItemLines = input.order.items.map((item) => ({
      code: item.sku ?? item.productId,
      description: item.productName,
      quantity: Math.max(item.quantity, 1),
      gross: this.toMoneyNumber(Number(item.lineTotal)),
    }));

    const discountTotal = this.toMoneyNumber(Number(input.order.discountTotal ?? 0));
    if (discountTotal > 0 && baseItemLines.length) {
      const discountAllocations = this.allocateAmountByWeight(
        discountTotal,
        baseItemLines.map((line) => line.gross),
      );
      for (let index = 0; index < baseItemLines.length; index += 1) {
        baseItemLines[index].gross = this.toMoneyNumber(
          Math.max(baseItemLines[index].gross - discountAllocations[index], 0),
        );
      }
    }

    const shippingFee = this.toMoneyNumber(Number(input.order.shippingFee ?? 0));
    const composedLines = [
      ...baseItemLines,
      ...(shippingFee > 0
        ? [
            {
              code: 'SHIPPING',
              description: 'Costo de delivery',
              quantity: 1,
              gross: shippingFee,
            },
          ]
        : []),
    ].filter((line) => line.gross > 0);

    if (!composedLines.length) {
      const subtotal = targetSubtotal;
      const total = targetTotal;
      const igv = this.toMoneyNumber(total - subtotal);
      return [
        {
          unidad_de_medida: 'NIU',
          codigo: 'ORDER_TOTAL',
          descripcion: `Pedido ${input.order.id.slice(0, 8)}`,
          cantidad: 1,
          valor_unitario: this.toMoney(subtotal),
          precio_unitario: this.toMoney(total),
          subtotal: this.toMoney(subtotal),
          tipo_de_igv: 1,
          igv: this.toMoney(igv),
          total: this.toMoney(total),
          anticipo_regularizacion: false,
        },
      ];
    }

    const composedTotal = this.toMoneyNumber(composedLines.reduce((acc, line) => acc + line.gross, 0));
    const delta = this.toMoneyNumber(targetTotal - composedTotal);
    if (delta !== 0) {
      const lastIndex = composedLines.length - 1;
      composedLines[lastIndex].gross = this.toMoneyNumber(Math.max(composedLines[lastIndex].gross + delta, 0));
    }
    const reconciledTotal = this.toMoneyNumber(composedLines.reduce((acc, line) => acc + line.gross, 0));
    if (reconciledTotal !== targetTotal) {
      const subtotal = targetSubtotal;
      const total = targetTotal;
      const igv = this.toMoneyNumber(total - subtotal);
      return [
        {
          unidad_de_medida: 'NIU',
          codigo: 'ORDER_TOTAL',
          descripcion: `Pedido ${input.order.id.slice(0, 8)}`,
          cantidad: 1,
          valor_unitario: this.toMoney(subtotal),
          precio_unitario: this.toMoney(total),
          subtotal: this.toMoney(subtotal),
          tipo_de_igv: 1,
          igv: this.toMoney(igv),
          total: this.toMoney(total),
          anticipo_regularizacion: false,
        },
      ];
    }

    const subtotalAllocations = this.allocateAmountByWeight(
      targetSubtotal,
      composedLines.map((line) => line.gross),
    );

    return composedLines.map((line, index) => {
      const lineSubtotal = this.toMoneyNumber(subtotalAllocations[index]);
      const lineTotal = this.toMoneyNumber(line.gross);
      const lineTax = this.toMoneyNumber(lineTotal - lineSubtotal);
      const quantity = Math.max(line.quantity, 1);
      const unitSubtotal = lineSubtotal / quantity;
      const unitTotal = lineTotal / quantity;

      return {
        unidad_de_medida: 'NIU',
        codigo: line.code,
        descripcion: line.description,
        cantidad: quantity,
        valor_unitario: this.toDecimal(unitSubtotal, 10),
        precio_unitario: this.toDecimal(unitTotal, 10),
        subtotal: this.toMoney(lineSubtotal),
        tipo_de_igv: 1,
        igv: this.toMoney(lineTax),
        total: this.toMoney(lineTotal),
        anticipo_regularizacion: false,
      };
    });
  }

  private allocateAmountByWeight(totalAmount: number, weights: number[]): number[] {
    const normalizedWeights = weights.map((weight) => (weight > 0 ? weight : 0));
    if (!normalizedWeights.length) {
      return [];
    }

    const totalCents = Math.max(Math.round(this.toMoneyNumber(totalAmount) * 100), 0);
    if (totalCents === 0) {
      return normalizedWeights.map(() => 0);
    }

    const weightSum = normalizedWeights.reduce((acc, value) => acc + value, 0);
    const effectiveWeights = weightSum > 0 ? normalizedWeights : normalizedWeights.map(() => 1);
    const effectiveWeightSum = effectiveWeights.reduce((acc, value) => acc + value, 0);

    const rawAllocations = effectiveWeights.map(
      (weight, index) => (totalCents * weight) / effectiveWeightSum + index * Number.EPSILON,
    );
    const floorAllocations = rawAllocations.map((raw) => Math.floor(raw));
    let remaining = totalCents - floorAllocations.reduce((acc, cents) => acc + cents, 0);

    const orderedByRemainder = rawAllocations
      .map((raw, index) => ({ index, remainder: raw - floorAllocations[index] }))
      .sort((left, right) => right.remainder - left.remainder);

    for (let i = 0; i < orderedByRemainder.length && remaining > 0; i += 1) {
      floorAllocations[orderedByRemainder[i].index] += 1;
      remaining -= 1;
    }

    return floorAllocations.map((cents) => cents / 100);
  }

  private async nextCorrelative(
    tenantId: string,
    series: string,
    kind: BillingDocumentKind,
  ): Promise<number> {
    const latest = await this.documentsRepository.findOne({
      where: {
        tenantId,
        series,
        kind,
      },
      order: {
        number: 'DESC',
      },
    });

    return (latest?.number ?? 0) + 1;
  }

  private sanitizeSettings(settings: BillingSettings | null): Record<string, unknown> {
    if (!settings) {
      return {
        configured: false,
      };
    }

    return {
      configured: true,
      id: settings.id,
      tenantId: settings.tenantId,
      provider: settings.provider,
      environment: settings.environment,
      isActive: settings.isActive,
      issuerRuc: settings.issuerRuc,
      issuerBusinessName: settings.issuerBusinessName,
      issuerAddress: settings.issuerAddress,
      invoiceSeries: settings.invoiceSeries,
      receiptSeries: settings.receiptSeries,
      creditNoteSeries: settings.creditNoteSeries,
      apiBaseUrl: settings.apiBaseUrl,
      apiTokenConfigured: Boolean(settings.apiToken),
      extraConfig: settings.extraConfig,
      createdAt: settings.createdAt,
      updatedAt: settings.updatedAt,
    };
  }

  private async loadActiveSettings(tenantId: string): Promise<BillingSettings | null> {
    const settings = await this.loadSettingsWithToken(tenantId);
    if (!settings?.isActive) {
      return null;
    }
    this.assertSettingsConsistency(settings);
    return settings;
  }

  private async loadSettingsWithToken(tenantId: string): Promise<BillingSettings | null> {
    return this.settingsRepository
      .createQueryBuilder('billing')
      .addSelect('billing.apiToken')
      .where('billing.tenantId = :tenantId', { tenantId })
      .getOne();
  }

  private async resolveTargetTenantId(tenantIdInput: string | undefined, actor: Actor): Promise<string> {
    if (actor.role === UserRole.PLATFORM_SUPERADMIN) {
      if (!tenantIdInput) {
        throw new ConflictException('tenantId es obligatorio para superadmin');
      }
      await this.assertTenantExists(tenantIdInput);
      return tenantIdInput;
    }

    if (!actor.tenantId) {
      throw new NotFoundException('Tenant no encontrado');
    }
    if (tenantIdInput && tenantIdInput !== actor.tenantId) {
      throw new NotFoundException('Tenant no encontrado');
    }
    await this.assertTenantExists(actor.tenantId);
    return actor.tenantId;
  }

  private assertOrderAccess(order: Order, actor: Actor): void {
    if (actor.role === UserRole.PLATFORM_SUPERADMIN) {
      return;
    }

    if (
      actor.role === UserRole.TENANT_ADMIN ||
      actor.role === UserRole.ORDER_MANAGER ||
      actor.role === UserRole.SUPPORT
    ) {
      if (!actor.tenantId || actor.tenantId !== order.tenantId) {
        throw new NotFoundException('Orden no encontrada');
      }
      return;
    }

    if (order.userId !== actor.userId) {
      throw new NotFoundException('Orden no encontrada');
    }
  }

  private async assertTenantExists(tenantId: string): Promise<void> {
    const tenant = await this.tenantsRepository.findOne({ where: { id: tenantId } });
    if (!tenant) {
      throw new NotFoundException('Tenant no encontrado');
    }
  }

  private assertSettingsConsistency(settings: BillingSettings): void {
    if (settings.provider === BillingProvider.NUBEFACT) {
      if (!settings.issuerRuc) {
        throw new ConflictException('issuerRuc es obligatorio para Nubefact');
      }
      if (!settings.apiToken && !this.configService.get<string>('BILLING_NUBEFACT_API_TOKEN')) {
        throw new ConflictException('apiToken es obligatorio para Nubefact');
      }
    }
  }

  private tryParseJson(raw: string): Record<string, unknown> | null {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private toDayMonthYear(date: Date): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
  }

  private mapCustomerDocumentType(value: string): string {
    const normalized = value.trim().toUpperCase();
    if (normalized === 'RUC') return '6';
    if (normalized === 'DNI') return '1';
    if (normalized === 'CE') return '4';
    if (normalized === 'PASSPORT') return '7';
    return '0';
  }

  private normalizeOptionalString(value?: string): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const normalized = value.trim();
    return normalized.length ? normalized : null;
  }

  private toMoney(value: number): string {
    return value.toFixed(2);
  }

  private toMoneyNumber(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Number(value.toFixed(2));
  }

  private toDecimal(value: number, precision: number): string {
    if (!Number.isFinite(value)) {
      return '0';
    }
    return value.toFixed(precision);
  }

  private async renderBillingDocumentPdf(document: BillingDocument, order: Order): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const pdf = new PDFDocument({
        size: 'A4',
        margin: 48,
      });
      const chunks: Buffer[] = [];

      pdf.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      pdf.on('end', () => resolve(Buffer.concat(chunks)));
      pdf.on('error', (error) => reject(error));

      const kindLabel =
        document.kind === BillingDocumentKind.INVOICE
          ? 'FACTURA'
          : document.kind === BillingDocumentKind.RECEIPT
            ? 'BOLETA'
            : 'NOTA DE CREDITO';

      pdf.fontSize(18).text(kindLabel, { align: 'left' });
      pdf.moveDown(0.35);
      pdf.fontSize(11).text(`Comprobante: ${document.documentNumber}`);
      pdf.fontSize(10).text(`Orden: ${order.id}`);
      pdf.fontSize(10).text(`Fecha emision: ${document.issueDate.toISOString()}`);
      pdf.fontSize(10).text(`Moneda: ${document.currency}`);
      pdf.moveDown(0.6);

      pdf.fontSize(12).text('Cliente', { underline: true });
      pdf.moveDown(0.2);
      pdf.fontSize(10).text(`Nombre: ${document.customerName}`);
      pdf.fontSize(10).text(`Documento: ${document.customerDocumentType} ${document.customerDocumentNumber}`);
      pdf.moveDown(0.6);

      pdf.fontSize(12).text('Items', { underline: true });
      pdf.moveDown(0.2);

      const items = this.extractPdfItems(document.requestPayload);
      if (!items.length) {
        pdf.fontSize(10).text('No hay detalle de items en el comprobante.');
      } else {
        for (const item of items) {
          const quantity = typeof item.quantity === 'number' ? item.quantity : 1;
          const name = this.asText(item.name) || this.asText(item.descripcion) || 'Item';
          const unitPrice = this.asText(item.unitPrice) || this.asText(item.precio_unitario) || '-';
          const lineTotal = this.asText(item.lineTotal) || this.asText(item.total) || '-';
          pdf
            .fontSize(10)
            .text(
              `${name} | Cant: ${quantity} | Unit: ${unitPrice} | Total: ${lineTotal}`,
            );
        }
      }

      pdf.moveDown(0.8);
      pdf.fontSize(12).text('Totales', { underline: true });
      pdf.moveDown(0.2);
      pdf.fontSize(10).text(`Subtotal: ${document.subtotal}`);
      pdf.fontSize(10).text(`IGV: ${document.taxTotal}`);
      pdf.fontSize(10).text(`Total: ${document.total}`);

      if (document.externalId) {
        pdf.moveDown(0.5);
        pdf.fontSize(9).text(`Referencia proveedor: ${document.externalId}`);
      }

      pdf.end();
    });
  }

  private extractPdfItems(payload: Record<string, unknown> | null): Array<Record<string, unknown>> {
    if (!payload || typeof payload !== 'object') {
      return [];
    }

    const maybeItems = payload.items;
    if (!Array.isArray(maybeItems)) {
      return [];
    }

    return maybeItems.filter((item) => typeof item === 'object' && item !== null) as Array<
      Record<string, unknown>
    >;
  }

  private asText(value: unknown): string | null {
    if (typeof value === 'string') {
      const normalized = value.trim();
      return normalized.length ? normalized : null;
    }
    if (typeof value === 'number') {
      return value.toString();
    }
    return null;
  }

  private isHttpUrl(value: string): boolean {
    const normalized = value.trim();
    return normalized.startsWith('http://') || normalized.startsWith('https://');
  }

  private decorateBillingDocument(document: BillingDocument): BillingDocument {
    return {
      ...document,
      pdfUrl: this.extractProviderPdfUrl(document.providerResponse),
    } as BillingDocument;
  }
}
