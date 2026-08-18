import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';

@Injectable()
export class WsJwtGuard implements CanActivate {
  private readonly logger = new Logger(WsJwtGuard.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      const client: Socket = context.switchToWs().getClient<Socket>();
      const authHeader = client.handshake.auth?.token || client.handshake.headers?.authorization;
      
      if (!authHeader) {
        throw new WsException('Unauthorized: Missing token');
      }

      // Format could be "Bearer <token>" or just "<token>"
      const token = authHeader.split(' ').length === 2 ? authHeader.split(' ')[1] : authHeader;

      const secret = this.configService.get<string>('JWT_ACCESS_SECRET');
      const payload = this.jwtService.verify(token, { secret });

      // Check if user exists
      const user = await this.usersService.findById(payload.sub);
      if (!user) {
        throw new WsException('Unauthorized: User not found');
      }

      // Attach user to socket data for easy access later
      client.data.user = { userId: payload.sub, username: user.username, displayName: user.displayName };

      return true;
    } catch (err) {
      this.logger.error('WebSocket Authentication error', err.message);
      throw new WsException('Unauthorized');
    }
  }
}
