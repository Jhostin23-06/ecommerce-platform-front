import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { Repository } from 'typeorm';
import { v2 as cloudinary } from 'cloudinary';
import { UserRole } from '../../auth/enums/user-role.enum';
import { Tenant } from '../../tenants/tenant.entity';
import { UploadImageDto } from '../dto/upload-image.dto';

type Actor = { role: UserRole; tenantId: string | null };
type UploadProvider = 'cloudinary' | 's3';

@Injectable()
export class UploadsService {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(Tenant)
    private readonly tenantsRepository: Repository<Tenant>,
  ) {}

  async uploadImage(
    file: Express.Multer.File | undefined,
    uploadImageDto: UploadImageDto,
    actor: Actor,
  ): Promise<{ url: string; key: string; provider: UploadProvider }> {
    this.assertTenantAccess(uploadImageDto.tenantId, actor);
    await this.ensureTenantExists(uploadImageDto.tenantId);
    this.validateFile(file);

    const provider = (this.configService.get<string>('UPLOAD_PROVIDER') ?? 'cloudinary').toLowerCase();
    if (provider === 'cloudinary') {
      return this.uploadToCloudinary(file!, uploadImageDto.tenantId);
    }
    if (provider === 's3') {
      return this.uploadToS3(file!, uploadImageDto.tenantId);
    }

    throw new BadRequestException('UPLOAD_PROVIDER invalido. Usa cloudinary o s3.');
  }

  private validateFile(file: Express.Multer.File | undefined): void {
    if (!file) {
      throw new BadRequestException('Se requiere un archivo de imagen (campo: file)');
    }

    const maxFileSizeMb = Number(this.configService.get<string>('UPLOAD_MAX_FILE_SIZE_MB') ?? '5');
    const maxFileSizeBytes = maxFileSizeMb * 1024 * 1024;
    if (file.size > maxFileSizeBytes) {
      throw new BadRequestException(`El archivo supera el tamano maximo de ${maxFileSizeMb}MB`);
    }

    const allowed = (this.configService.get<string>('UPLOAD_ALLOWED_MIME') ?? 'image/jpeg,image/png,image/webp')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException(`Tipo de archivo invalido. Permitidos: ${allowed.join(', ')}`);
    }
  }

  private async uploadToCloudinary(
    file: Express.Multer.File,
    tenantId: string,
  ): Promise<{ url: string; key: string; provider: UploadProvider }> {
    const cloudName = this.configService.get<string>('CLOUDINARY_CLOUD_NAME');
    const apiKey = this.configService.get<string>('CLOUDINARY_API_KEY');
    const apiSecret = this.configService.get<string>('CLOUDINARY_API_SECRET');
    const baseFolder = this.configService.get<string>('CLOUDINARY_FOLDER') ?? 'ecommerce';

    if (!cloudName || !apiKey || !apiSecret) {
      throw new InternalServerErrorException('Las credenciales de Cloudinary no estan configuradas');
    }

    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });

    const folder = `${baseFolder}/${tenantId}`;
    const result = await new Promise<{ secure_url: string; public_id: string }>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder, resource_type: 'image' },
        (error, uploadResult) => {
          if (error || !uploadResult) {
            reject(error ?? new Error('Fallo la carga en Cloudinary'));
            return;
          }
          resolve({
            secure_url: uploadResult.secure_url,
            public_id: uploadResult.public_id,
          });
        },
      );

      stream.end(file.buffer);
    });

    return {
      url: result.secure_url,
      key: result.public_id,
      provider: 'cloudinary',
    };
  }

  private async uploadToS3(
    file: Express.Multer.File,
    tenantId: string,
  ): Promise<{ url: string; key: string; provider: UploadProvider }> {
    const region = this.configService.get<string>('AWS_REGION');
    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY');
    const bucket = this.configService.get<string>('S3_BUCKET');
    const prefix = this.configService.get<string>('S3_UPLOAD_PREFIX') ?? 'ecommerce';

    if (!region || !accessKeyId || !secretAccessKey || !bucket) {
      throw new InternalServerErrorException('Las credenciales de S3 no estan configuradas');
    }

    const extension = extname(file.originalname).toLowerCase() || this.extensionFromMime(file.mimetype);
    const key = `${prefix}/${tenantId}/${randomUUID()}${extension}`;

    const s3Client = new S3Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        CacheControl: 'public, max-age=31536000',
      }),
    );

    return {
      url: this.buildS3Url(bucket, region, key),
      key,
      provider: 's3',
    };
  }

  private buildS3Url(bucket: string, region: string, key: string): string {
    const customBase = this.configService.get<string>('S3_PUBLIC_BASE_URL')?.trim();
    if (customBase) {
      return `${customBase.replace(/\/$/, '')}/${key}`;
    }

    if (region === 'us-east-1') {
      return `https://${bucket}.s3.amazonaws.com/${key}`;
    }

    return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  }

  private extensionFromMime(mimeType: string): string {
    const map: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'image/avif': '.avif',
    };
    return map[mimeType] ?? '.bin';
  }

  private async ensureTenantExists(tenantId: string): Promise<void> {
    const tenant = await this.tenantsRepository.findOne({ where: { id: tenantId } });
    if (!tenant) {
      throw new NotFoundException('Tenant no encontrado');
    }
  }

  private assertTenantAccess(targetTenantId: string, actor: Actor): void {
    if (actor.role === UserRole.PLATFORM_SUPERADMIN) {
      return;
    }

    if (!actor.tenantId || actor.tenantId !== targetTenantId) {
      throw new NotFoundException('Tenant no encontrado');
    }
  }
}
