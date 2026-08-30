import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class StorageService {
  private s3Client: S3Client;
  private readonly logger = new Logger(StorageService.name);
  private readonly bucketName = process.env.S3_BUCKET || '';

  constructor() {
    this.s3Client = new S3Client({
      region: process.env.S3_REGION || 'auto',
      endpoint: process.env.S3_ENDPOINT || '',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY || '',
        secretAccessKey: process.env.S3_SECRET_KEY || '',
      },
      forcePathStyle: true,
    });
  }

  async uploadFile(file: Express.Multer.File, folder: string): Promise<string> {
    if (!this.bucketName) {
      throw new Error('S3_BUCKET is not configured.');
    }

    const ext = file.originalname.split('.').pop() || 'jpg';
    const filename = `${folder}/${uuidv4()}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: filename,
      Body: file.buffer,
      ContentType: file.mimetype,
    });

    try {
      await this.s3Client.send(command);
      const baseUrl = process.env.API_URL || 'http://localhost:3000';
      return `${baseUrl}/storage/${filename}`;
    } catch (error) {
      this.logger.error(`Error uploading file to S3: ${error.message}`);
      throw error;
    }
  }

  async getFile(
    key: string,
  ): Promise<{ buffer: Uint8Array; contentType: string }> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });

    try {
      const response = await this.s3Client.send(command);
      if (!response.Body) {
        throw new Error('No body returned from S3');
      }
      const byteArray = await response.Body.transformToByteArray();
      return {
        buffer: byteArray,
        contentType: response.ContentType || 'application/octet-stream',
      };
    } catch (error) {
      this.logger.error(`Error getting file from S3: ${error.message}`);
      throw new InternalServerErrorException('Error retrieving file');
    }
  }
}
