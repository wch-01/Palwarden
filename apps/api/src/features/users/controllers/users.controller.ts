import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Roles, RolesGuard } from '../../auth/guards/roles.guard';
import { SessionGuard } from '../../auth/guards/session.guard';
import type { RequestUser } from '../../auth/services/auth.service';
import { CreateUserDto, UpdateUserDto } from '../dto/user-management.dto';
import { UsersService } from '../services/users.service';

@UseGuards(SessionGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Roles('OWNER')
  @Get()
  list() {
    return this.users.list();
  }

  @Roles('OWNER')
  @Post()
  create(@Body() body: CreateUserDto, @Req() req: Request & { user: RequestUser }) {
    return this.users.create(body, req.user.id);
  }

  @Roles('OWNER')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateUserDto, @Req() req: Request & { user: RequestUser }) {
    return this.users.update(id, body, req.user.id);
  }

  @Roles('OWNER')
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: Request & { user: RequestUser }) {
    return this.users.remove(id, req.user.id);
  }
}
