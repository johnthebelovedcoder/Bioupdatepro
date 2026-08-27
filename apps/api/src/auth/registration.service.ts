import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProvisioningService } from './provisioning.service';
import { hashPassword } from './password';
import { AuthService, type AuthenticatedUser } from './auth.service';

/**
 * Signing up a farm.
 *
 * The person registering is the owner: they create the farm and become its
 * first user, with the authority to invite everyone else. That is the shape the
 * product is sold in — a worker does not sign themselves up to a farm, they are
 * invited to one that already exists — so this endpoint deliberately does not
 * accept a company to join. Joining an existing farm is an invitation flow and
 * is a different thing with different rules.
 *
 * Everything happens in one transaction: the company, its chart of accounts,
 * its calendar, and the user. A half-registered farm is not a state anyone
 * should be able to sign in to.
 */
@Injectable()
export class RegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioning: ProvisioningService,
    private readonly auth: AuthService,
  ) {}

  async register(input: {
    fullName: string;
    email: string;
    password: string;
    farmName: string;
    financialYearStartMonth?: number;
  }): Promise<{ accessToken: string; user: AuthenticatedUser }> {
    const email = input.email.trim().toLowerCase();
    const fullName = input.fullName.trim();
    const farmName = input.farmName.trim();

    if (!fullName) throw new BadRequestException('Enter your name.');
    if (!farmName) throw new BadRequestException('Enter the name of your farm.');
    if (!isEmail(email)) throw new BadRequestException('That email address does not look right.');

    const problem = passwordProblem(input.password);
    if (problem) throw new BadRequestException(problem);

    const taken = await this.prisma.user.findUnique({ where: { email } });
    if (taken) {
      /*
       * Told plainly rather than obscured.
       *
       * Hiding this on a SIGN-UP form protects nobody: anybody can discover the
       * same fact by trying to register, and the alternative is a person who
       * already has an account being told "check your email" and never getting
       * one. The sign-in form is where the vaguer message belongs, and it has
       * one.
       */
      throw new ConflictException('An account with that email already exists. Try signing in.');
    }

    const passwordHash = await hashPassword(input.password);

    await this.prisma.$transaction(
      async (tx) => {
        const { companyId } = await this.provisioning.provisionCompany(tx, {
          farmName,
          ...(input.financialYearStartMonth
            ? { financialYearStartMonth: input.financialYearStartMonth }
            : {}),
        });

        await tx.user.create({
          data: {
            email,
            fullName,
            passwordHash,
            companyId,
            // The person who creates the farm can do everything in it,
            // including inviting the people who cannot.
            roles: ['ADMINISTRATOR', 'CFO'],
          },
        });
      },
      // Provisioning writes an entire chart of accounts and twelve periods; the
      // default 5s is not enough on a cold pool.
      { timeout: 30_000 },
    );

    // Sign them straight in. Making somebody type the password they just chose
    // is friction with no security benefit whatsoever.
    return this.auth.login(email, input.password);
  }
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

/**
 * What is wrong with this password, in words the person can act on.
 *
 * Length over composition rules. A twelve-character passphrase is stronger than
 * "P@ss1" and far likelier to be remembered rather than written on the wall of
 * the feed store — which is the actual threat model on a farm where a handset
 * is shared.
 */
export function passwordProblem(password: string): string | null {
  if (!password || password.length < 10) {
    return 'Use at least 10 characters. A short phrase you will remember is ideal.';
  }
  if (password.length > 200) return 'That password is too long.';
  if (/^\d+$/.test(password)) return 'Use more than just numbers.';

  const common = ['password', '1234567890', 'qwerty', 'letmein', 'farm12345'];
  if (common.some((entry) => password.toLowerCase().includes(entry))) {
    return 'That password is too easy to guess.';
  }
  return null;
}
