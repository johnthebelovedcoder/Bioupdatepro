import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule, minutes } from '@nestjs/throttler';
import { CoreModule } from '../core.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RegistrationService } from './registration.service';
import { ProvisioningService } from './provisioning.service';
import { InvitationService } from './invitation.service';
import { PasswordResetService } from './password-reset.service';
import { EmailService } from './email.service';
import { RoleSectionAccessService } from './role-section-access.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CompanyScopeGuard } from './company-scope.guard';
import { OwnedRecordGuard } from './owned-record.guard';
import { RolesGuard } from './roles.guard';
import { JwtStrategy } from './jwt.strategy';
import { JWT_EXPIRES_IN, jwtSecret } from './jwt.config';

@Module({
  imports: [
    CoreModule,
    PassportModule,
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: jwtSecret(),
        signOptions: { expiresIn: JWT_EXPIRES_IN },
      }),
    }),
    /*
     * Scoped here, not registered globally — the routes that actually need
     * brute-force protection (login, register, forgot-password, a reset or
     * invitation token being redeemed) are the handful of @Public() ones in
     * this module that accept credentials from someone with no session yet.
     * Everything else already sits behind JwtAuthGuard, where the cost of
     * guessing is a valid bearer token, not a password. Each route below
     * applies its own @Throttle() limit; this default only covers one that
     * doesn't bother to override it.
     */
    ThrottlerModule.forRoot([{ name: 'default', ttl: minutes(15), limit: 20 }]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    RegistrationService,
    ProvisioningService,
    InvitationService,
    PasswordResetService,
    EmailService,
    RoleSectionAccessService,
    JwtStrategy,
    // Global: protected by default, opt out with @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    /*
     * Order matters. Global guards run in the order they are provided, and this
     * one reads `request.user`, which only exists once the guard above has
     * verified the token and populated it.
     */
    { provide: APP_GUARD, useClass: CompanyScopeGuard },
    /*
     * Last, and for the same reason: it reads `request.user` and it queries the
     * database, so it should only run once the cheaper checks above have
     * passed. Inert on routes that do not carry an @OwnedRecord rule.
     */
    { provide: APP_GUARD, useClass: OwnedRecordGuard },
    /*
     * Roles last. It is a pure metadata check with no database access, but it
     * runs after the cheaper company checks so a request for another tenant is
     * refused as not-found before it is refused as not-permitted — which keeps
     * the permission model from leaking through a 403 on somebody else's row.
     */
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
