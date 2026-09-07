import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Notification,
  NotificationDocument,
  NotificationType,
} from './schemas/notification.schema';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { BroadcastNotificationDto } from './dto/broadcast-notification.dto';
import { UsersService } from '../users/users.service';
import { FirebaseService } from '../firebase/firebase.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  // Callbacks hooked by ChatGateway
  public onNotificationCreated?: (notification: any) => void;
  public onAdminBroadcast?: (broadcast: any) => void;
  public onAdminAlert?: (alert: any) => void;

  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
    private readonly usersService: UsersService,
    private readonly firebaseService: FirebaseService,
  ) {}

  /**
   * Create, persist, and dispatch a notification both via Realtime Socket and Push (FCM)
   */
  async createAndSend(dto: CreateNotificationDto): Promise<NotificationDocument> {
    if (!Types.ObjectId.isValid(dto.recipientId)) {
      throw new BadRequestException('Invalid recipient ID');
    }

    if (dto.senderId && !Types.ObjectId.isValid(dto.senderId)) {
      throw new BadRequestException('Invalid sender ID');
    }

    const notification = new this.notificationModel({
      recipient: new Types.ObjectId(dto.recipientId),
      sender: dto.senderId ? new Types.ObjectId(dto.senderId) : null,
      type: dto.type || NotificationType.SYSTEM,
      title: dto.title,
      message: dto.message,
      data: dto.data || {},
      isRead: false,
    });

    const saved = await notification.save();
    const populated = await this.notificationModel
      .findById(saved._id)
      .populate('sender', 'username displayName avatarUrl')
      .exec();

    // 1. Real-time emit via Socket
    try {
      if (this.onNotificationCreated && populated) {
        this.onNotificationCreated(populated.toJSON());
      }
    } catch (err) {
      this.logger.error('Failed to emit realtime notification:', err);
    }

    // 2. Push Notification via FCM
    try {
      const recipientUser = await this.usersService.findById(dto.recipientId);
      if (recipientUser && recipientUser.pushToken) {
        await this.firebaseService.sendPushNotification(
          recipientUser.pushToken,
          dto.title,
          dto.message,
          {
            type: dto.type || NotificationType.SYSTEM,
            notificationId: saved._id.toString(),
            ...(dto.data ? { extra: JSON.stringify(dto.data) } : {}),
          },
        );
      }
    } catch (pushErr) {
      this.logger.error('Failed to send FCM push notification:', pushErr);
    }

    return (populated || saved) as NotificationDocument;
  }

  /**
   * Retrieve paginated notifications for a given user
   */
  async getUserNotifications(
    userId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<{
    notifications: NotificationDocument[];
    total: number;
    unreadCount: number;
    page: number;
    pages: number;
  }> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user ID');
    }

    const userObjectId = new Types.ObjectId(userId);
    const skip = Math.max(0, (page - 1) * limit);

    const [notifications, total, unreadCount] = await Promise.all([
      this.notificationModel
        .find({ recipient: userObjectId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('sender', 'username displayName avatarUrl')
        .exec(),
      this.notificationModel.countDocuments({ recipient: userObjectId }).exec(),
      this.notificationModel
        .countDocuments({ recipient: userObjectId, isRead: false })
        .exec(),
    ]);

    return {
      notifications,
      total,
      unreadCount,
      page,
      pages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Get unread notifications count for a user
   */
  async getUnreadCount(userId: string): Promise<number> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user ID');
    }
    return this.notificationModel
      .countDocuments({ recipient: new Types.ObjectId(userId), isRead: false })
      .exec();
  }

  /**
   * Mark a single notification as read
   */
  async markAsRead(
    notificationId: string,
    userId: string,
  ): Promise<NotificationDocument> {
    if (!Types.ObjectId.isValid(notificationId)) {
      throw new BadRequestException('Invalid notification ID');
    }
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user ID');
    }

    const updated = await this.notificationModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(notificationId),
          recipient: new Types.ObjectId(userId),
        },
        { isRead: true, readAt: new Date() },
        { new: true },
      )
      .exec();

    if (!updated) {
      throw new NotFoundException('Notification not found');
    }

    return updated;
  }

  /**
   * Mark all notifications for a user as read
   */
  async markAllAsRead(userId: string): Promise<{ modifiedCount: number }> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user ID');
    }

    const result = await this.notificationModel
      .updateMany(
        { recipient: new Types.ObjectId(userId), isRead: false },
        { isRead: true, readAt: new Date() },
      )
      .exec();

    return { modifiedCount: result.modifiedCount };
  }

  /**
   * Delete a notification
   */
  async deleteNotification(
    notificationId: string,
    userId: string,
  ): Promise<{ success: boolean }> {
    if (!Types.ObjectId.isValid(notificationId)) {
      throw new BadRequestException('Invalid notification ID');
    }
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user ID');
    }

    const deleted = await this.notificationModel
      .findOneAndDelete({
        _id: new Types.ObjectId(notificationId),
        recipient: new Types.ObjectId(userId),
      })
      .exec();

    if (!deleted) {
      throw new NotFoundException('Notification not found');
    }

    return { success: true };
  }

  /**
   * Admin broadcast: Send global alert to all connected users and push
   */
  async broadcastAdminNotification(
    dto: BroadcastNotificationDto,
  ): Promise<{ success: boolean; sentCount: number }> {
    this.logger.log(`Broadcasting admin notification: ${dto.title}`);

    // 1. Emit realtime broadcast event
    if (this.onAdminBroadcast) {
      this.onAdminBroadcast({
        title: dto.title,
        message: dto.message,
        data: dto.data || {},
        createdAt: new Date(),
      });
    }

    // 2. Dispatch FCM Push Notification to all users via topic
    try {
      await this.firebaseService.sendTopicNotification(
        'all_users',
        dto.title,
        dto.message,
        {
          type: NotificationType.SYSTEM,
          ...(dto.data ? { extra: JSON.stringify(dto.data) } : {}),
        },
      );
    } catch (pushErr) {
      this.logger.error('Failed to send broadcast push notification:', pushErr);
    }

    return { success: true, sentCount: 1 };
  }

  /**
   * Send alert directly to admins / moderators (e.g. reports, stream flagged)
   */
  sendAdminAlert(alert: {
    type: string;
    title: string;
    message: string;
    data?: any;
  }): void {
    if (this.onAdminAlert) {
      this.onAdminAlert({
        ...alert,
        createdAt: new Date(),
      });
    }
  }
}
