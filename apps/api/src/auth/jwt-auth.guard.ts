import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { firstValueFrom, isObservable } from 'rxjs';
import { IS_PUBLIC_KEY } from './current-user.decorator';
import type { Request } from 'express';
import type { AuthenticatedUser } from './auth.service';

/**
 * Applied globally, so a new controller is protected by default and has to opt
 * OUT with @Public(). The reverse — remembering to add a guard to each new
 * posting route — is the kind of omission nobody notices until it matters.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const result = super.canActivate(context);
    const authenticated = isObservable(result) ? await firstValueFrom(result) : await result;
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const path = request.path.replace(/\/+$/, '');
    const mfaRoute = /\/auth\/mfa\/(setup|confirm)$/.test(path);
    const sessionProbe = /\/auth\/me$/.test(path);
    if (
      request.user &&
      (request.user.mfaSetupOnly || (request.user.mfaRequired && !request.user.mfaEnabled)) &&
      !mfaRoute &&
      !sessionProbe
    ) {
      throw new ForbiddenException('Complete authenticator MFA setup before using BioAssetPro.');
    }
    return authenticated;
  }
}
