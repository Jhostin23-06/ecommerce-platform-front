import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../auth/enums/user-role.enum';
import { ChangeMyPasswordDto } from './dto/change-my-password.dto';
import { ListUsersDto } from './dto/list-users.dto';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UsersService } from './users.service';

type ActorRequest = {
  user: {
    userId: string;
    role: UserRole;
    tenantId: string | null;
  };
};

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getMe(@Req() req: ActorRequest) {
    return this.usersService.getMe(req.user);
  }

  @Patch('me/profile')
  updateMyProfile(@Req() req: ActorRequest, @Body() dto: UpdateMyProfileDto) {
    return this.usersService.updateMyProfile(req.user, dto);
  }

  @Patch('me/password')
  changeMyPassword(@Req() req: ActorRequest, @Body() dto: ChangeMyPasswordDto) {
    return this.usersService.changeMyPassword(req.user, dto);
  }

  @Roles(UserRole.PLATFORM_SUPERADMIN, UserRole.TENANT_ADMIN)
  @Get()
  listUsers(@Query() query: ListUsersDto, @Req() req: ActorRequest) {
    return this.usersService.listUsers(query, req.user);
  }

  @Roles(UserRole.PLATFORM_SUPERADMIN, UserRole.TENANT_ADMIN)
  @Get('customers')
  listCustomers(@Query() query: ListUsersDto, @Req() req: ActorRequest) {
    return this.usersService.listCustomers(query, req.user);
  }

  @Roles(UserRole.PLATFORM_SUPERADMIN, UserRole.TENANT_ADMIN)
  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: ActorRequest) {
    return this.usersService.findOne(id, req.user);
  }

  @Roles(UserRole.PLATFORM_SUPERADMIN, UserRole.TENANT_ADMIN)
  @Patch(':id/role')
  updateRole(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() updateUserRoleDto: UpdateUserRoleDto,
    @Req() req: ActorRequest,
  ) {
    return this.usersService.updateRole(id, updateUserRoleDto, req.user);
  }

  @Roles(UserRole.PLATFORM_SUPERADMIN, UserRole.TENANT_ADMIN)
  @Patch(':id/status')
  updateStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() updateUserStatusDto: UpdateUserStatusDto,
    @Req() req: ActorRequest,
  ) {
    return this.usersService.updateStatus(id, updateUserStatusDto, req.user);
  }
}
