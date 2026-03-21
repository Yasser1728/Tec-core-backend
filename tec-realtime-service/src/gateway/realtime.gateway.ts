import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger('RealtimeGateway');
  private readonly connectedUsers = new Map<string, string>(); // socketId → userId

  constructor(private readonly jwtService: JwtService) {}

  afterInit() {
    this.logger.log('✅ WebSocket Gateway initialized');
  }

  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        this.logger.warn(`[WS] No token — disconnecting ${client.id}`);
        client.disconnect();
        return;
      }

      const decoded = this.jwtService.verify(token) as any;
      const userId = decoded.sub ?? decoded.id;

      // ✅ Join user-specific room
      client.join(userId);
      this.connectedUsers.set(client.id, userId);

      this.logger.log(`[WS] Connected: ${userId} (socket: ${client.id})`);

      // ✅ إبعت confirmation للـ client
      client.emit('connected', {
        status: 'connected',
        userId,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.warn(`[WS] Auth failed — disconnecting ${client.id}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = this.connectedUsers.get(client.id);
    this.connectedUsers.delete(client.id);
    this.logger.log(`[WS] Disconnected: ${userId} (socket: ${client.id})`);
  }

  // ✅ Emit to specific user
  emitToUser(userId: string, event: string, data: unknown) {
    this.server.to(userId).emit(event, data);
    this.logger.log(`[WS] Emitted ${event} to user ${userId}`);
  }

  // ✅ Emit to all
  emitToAll(event: string, data: unknown) {
    this.server.emit(event, data);
  }

  getConnectedCount(): number {
    return this.connectedUsers.size;
  }
}
