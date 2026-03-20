import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Headers,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { StorageService, FileTypeEnum } from './storage.service';

@Controller('storage')
export class StorageController {
  constructor(
    private readonly storageService: StorageService,
    private readonly jwtService: JwtService,
  ) {}

  private getUserId(authorization: string): string {
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing token');
    }
    const token = authorization.replace('Bearer ', '');
    try {
      const decoded = this.jwtService.verify(token) as any;
      return decoded.sub ?? decoded.id ?? decoded.userId;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }

  // POST /storage/upload-url
  @Post('upload-url')
  async getUploadUrl(
    @Headers('authorization') auth: string,
    @Body() body: {
      filename: string;
      mimeType: string;
      size: number;
      folder?: string;
    },
  ) {
    const userId = this.getUserId(auth);
    const result = await this.storageService.getUploadUrl({
      userId,
      ...body,
    });
    return { success: true, data: result };
  }

  // POST /storage/files
  @Post('files')
  async saveFile(
    @Headers('authorization') auth: string,
    @Body() body: {
      key: string;
      filename: string;
      mimeType: string;
      size: number;
      metadata?: Record<string, unknown>;
    },
  ) {
    const userId = this.getUserId(auth);
    const file = await this.storageService.saveFile({
      userId,
      ...body,
    });
    return { success: true, data: { file } };
  }

  // GET /storage/files
  @Get('files')
  async getUserFiles(
    @Headers('authorization') auth: string,
    @Query('type') type?: FileTypeEnum,
  ) {
    const userId = this.getUserId(auth);
    const files = await this.storageService.getUserFiles(userId, type);
    return { success: true, data: { files } };
  }

  // GET /storage/files/:id
  @Get('files/:id')
  async getFile(
    @Headers('authorization') auth: string,
    @Param('id') id: string,
  ) {
    const userId = this.getUserId(auth);
    const file = await this.storageService.getFile(id, userId);
    return { success: true, data: { file } };
  }

  // DELETE /storage/files/:id
  @Delete('files/:id')
  async deleteFile(
    @Headers('authorization') auth: string,
    @Param('id') id: string,
  ) {
    const userId = this.getUserId(auth);
    await this.storageService.deleteFile(id, userId);
    return { success: true };
  }
}
