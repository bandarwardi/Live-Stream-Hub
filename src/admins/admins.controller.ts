import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { AdminsService } from './admins.service';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import * as bcrypt from 'bcrypt';

@Controller('admin/admins')
export class AdminsController {
  constructor(private readonly adminsService: AdminsService) {}

  // Temporary endpoint to create the first admin or subsequent admins by existing admin
  // Protected to prevent unauthorized creation of admins
  @UseGuards(AdminAuthGuard)
  @Post()
  async createAdmin(@Body() body: any) {
    const salt = await bcrypt.genSalt();
    const hash = await bcrypt.hash(body.password, salt);
    
    return this.adminsService.create({
      name: body.name,
      username: body.username,
      email: body.email,
      passwordHash: hash,
      role: body.role || 'SUPER_ADMIN',
    });
  }
}
