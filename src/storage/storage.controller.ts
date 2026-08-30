import {
  Controller,
  Get,
  Param,
  Res,
  Post,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { StorageService } from './storage.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { Response } from 'express';

@Controller('storage')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @UseGuards(JwtAuthGuard)
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadMedia(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    // Limit file size (e.g. 50MB for video/audio)
    if (file.size > 50 * 1024 * 1024) {
      throw new BadRequestException('File is too large (max 50MB)');
    }
    const url = await this.storageService.uploadFile(file, 'chat-media');
    return { url };
  }

  @Get(':folder/:filename')
  async getFile(
    @Param('folder') folder: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    const key = `${folder}/${filename}`;
    if (!folder || !filename) {
      return res.status(400).send('Key is required');
    }

    try {
      const { buffer, contentType } = await this.storageService.getFile(key);
      res.set({
        'Content-Type': contentType,
        'Content-Length': buffer.length,
        'Cache-Control': 'public, max-age=31536000',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      });
      res.send(Buffer.from(buffer));
    } catch (err) {
      console.error('Storage Proxy Error:', err);
      return res.status(404).send('File not found');
    }
  }
}
