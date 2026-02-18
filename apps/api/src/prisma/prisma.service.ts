import { Injectable } from '@nestjs/common';
import { prisma } from '@diaz/db';

@Injectable()
export class PrismaService {
  readonly client = prisma;
}
