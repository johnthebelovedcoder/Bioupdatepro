import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService, AuthenticatedUser, JwtPayload } from './auth.service';
import { jwtSecret } from './jwt.config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly auth: AuthService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecret(),
    });
  }

  /** The return value becomes `request.user`. */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (payload.purpose) {
      throw new UnauthorizedException('Complete MFA verification before accessing the application.');
    }
    const user = await this.auth.resolve(payload.sub);
    if (payload.mfaSetupOnly) {
      if (!user.mfaRequired || user.mfaEnabled) {
        throw new UnauthorizedException('This authenticator setup session is no longer valid.');
      }
      return { ...user, mfaSetupOnly: true };
    }
    if (user.mfaRequired && (!user.mfaEnabled || !payload.mfaVerified)) {
      throw new UnauthorizedException('Authenticator verification is required. Sign in again.');
    }
    return user;
  }
}
