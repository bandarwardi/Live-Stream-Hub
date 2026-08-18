import { Controller, Get, Param, Res } from '@nestjs/common';
import { StorageService } from './storage.service';
import type { Response } from 'express';

@Controller('storage')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

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
