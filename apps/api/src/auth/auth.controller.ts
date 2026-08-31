import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { IsEmail, IsString, MinLength } from 'class-validator';
import type { Request } from 'express';
import { AuthService, AuthenticatedUser } from './auth.service';
import { CurrentCompany, CurrentUser, Public } from './current-user.decorator';
import type { WorkflowActor } from '../workflow/workflow.types';
import { RegistrationService } from './registration.service';
import { InvitationService } from './invitation.service';
import { RoleSectionAccessService } from './role-section-access.service';
import { Roles, AnyRole } from './roles.guard';

class LoginDto {
  @IsEmail({}, { message: 'Enter a valid email address.' })
  email!: string;

  @IsString()
  @MinLength(1, { message: 'Enter your password.' })
  password!: string;
}

class RegisterDto {
  @IsString()
  @MinLength(2, { message: 'Enter your name.' })
  fullName!: string;

  @IsEmail({}, { message: 'Enter a valid email address.' })
  email!: string;

  @IsString()
  @MinLength(10, { message: 'Use at least 10 characters.' })
  password!: string;

  @IsString()
  @MinLength(2, { message: 'Enter the name of your farm.' })
  farmName!: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly registration: RegistrationService,
    private readonly invitations: InvitationService,
    private readonly roleSections: RoleSectionAccessService,
  ) {}

  @Public()
  @Post('login')
  async login(@Body() body: LoginDto) {
    return this.auth.login(body.email, body.password);
  }

  /** Create a farm and its first user. */
  @Public()
  @Post('register')
  async register(@Body() body: RegisterDto) {
    return this.registration.register(body);
  }

  /**
   * Which sign-in providers are actually usable.
   *
   * The interface asks before it offers. A Google button that opens a broken
   * consent screen because no client id was ever configured is worse than no
   * button — the person cannot tell whether the farm's account is broken or the
   * product is, and they have no way to find out.
   */
  @Public()
  @Get('providers')
  providers() {
    return {
      password: true,
      google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      facebook: Boolean(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET),
    };
  }

  /* --- Invitations ------------------------------------------------------ */

  // SYSTEM_ADMIN (ROL-015): "Manage configuration, interfaces and access" —
  // access is literally named in their RACI line.
  @Roles('CFO', 'FARM_MANAGER', 'SYSTEM_ADMIN')
  @Post('invitations')
  async invite(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body() body: { email: string; roles: string[] },
  ) {
    return this.invitations.invite({
      companyId,
      actor,
      email: body.email,
      roles: body.roles ?? [],
    });
  }

  @Roles('CFO', 'FARM_MANAGER', 'SYSTEM_ADMIN')
  @Get('invitations')
  async listInvitations(@CurrentCompany() companyId: string) {
    return this.invitations.list(companyId);
  }

  @Roles('CFO', 'FARM_MANAGER', 'SYSTEM_ADMIN')
  @Post('invitations/:id/revoke')
  async revokeInvitation(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Param('id') id: string,
  ) {
    return this.invitations.revoke({ companyId, id, actor });
  }

  /* --- People already on the farm ---------------------------------------- */

  @Roles('CFO', 'FARM_MANAGER', 'SYSTEM_ADMIN')
  @Get('users')
  async listUsers(@CurrentCompany() companyId: string) {
    return this.invitations.listUsers(companyId);
  }

  @Roles('CFO', 'FARM_MANAGER', 'SYSTEM_ADMIN')
  @Post('users/:id/roles')
  async updateUserRoles(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Param('id') id: string,
    @Body() body: { roles: string[] },
  ) {
    return this.invitations.updateRoles({ companyId, actor, userId: id, roles: body.roles ?? [] });
  }

  @Roles('CFO', 'FARM_MANAGER', 'SYSTEM_ADMIN')
  @Post('users/:id/deactivate')
  async deactivateUser(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Param('id') id: string,
  ) {
    return this.invitations.setActive({ companyId, actor, userId: id, active: false });
  }

  @Roles('CFO', 'FARM_MANAGER', 'SYSTEM_ADMIN')
  @Post('users/:id/reactivate')
  async reactivateUser(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Param('id') id: string,
  ) {
    return this.invitations.setActive({ companyId, actor, userId: id, active: true });
  }

  /*
   * Public: the person following the link has no account yet, so there is
   * nothing to authenticate them with. The token IS the credential, which is
   * why it is long, hashed at rest and short-lived.
   */
  @Public()
  @Get('invitations/token/:token')
  async describeInvitation(@Param('token') token: string) {
    return this.invitations.describe(token);
  }

  @Public()
  @Post('invitations/token/:token/accept')
  async acceptInvitation(
    @Param('token') token: string,
    @Body() body: { fullName: string; password: string },
  ) {
    return this.invitations.accept({
      token,
      fullName: body.fullName,
      password: body.password,
    });
  }

  /** Who the current token belongs to — the frontend's session check. */
  @AnyRole('The session check. Every signed-in user asks who they are.')
  @Get('me')
  async me(@Req() request: Request & { user: AuthenticatedUser }) {
    return request.user;
  }

  /* --- Role → section access overrides (US-897-035) ---------------------- */

  /*
   * Every signed-in user needs this, not just admins — the sidebar reads it
   * for whichever roles the requester themselves holds, the same way `/me`
   * is open to everyone rather than gated to the people who could look
   * anybody up.
   */
  @AnyRole('The sidebar resolves its own visible sections from this on every load.')
  @Get('role-sections')
  async listRoleSections(@CurrentCompany() companyId: string) {
    return this.roleSections.list(companyId);
  }

  @Roles('CFO', 'FARM_MANAGER', 'SYSTEM_ADMIN')
  @Post('role-sections')
  async setRoleSection(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body() body: { role: string; section: string; enabled: boolean },
  ) {
    return this.roleSections.set({
      companyId,
      actor,
      role: body.role,
      section: body.section,
      enabled: Boolean(body.enabled),
    });
  }
}
