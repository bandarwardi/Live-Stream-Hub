import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { NotificationsService } from './notifications.service';
import { Notification, NotificationType } from './schemas/notification.schema';
import { UsersService } from '../users/users.service';
import { FirebaseService } from '../firebase/firebase.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let mockNotificationModel: any;
  let mockUsersService: any;
  let mockFirebaseService: any;

  const validRecipientId = new Types.ObjectId().toString();
  const validSenderId = new Types.ObjectId().toString();
  const validNotificationId = new Types.ObjectId().toString();

  beforeEach(async () => {
    mockNotificationModel = jest.fn().mockImplementation((dto) => ({
      ...dto,
      _id: new Types.ObjectId(validNotificationId),
      save: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(validNotificationId),
        ...dto,
      }),
    }));

    mockNotificationModel.findById = jest.fn().mockReturnValue({
      populate: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: new Types.ObjectId(validNotificationId),
          recipient: new Types.ObjectId(validRecipientId),
          title: 'Test Title',
          message: 'Test Message',
          toJSON: () => ({
            _id: validNotificationId,
            recipient: validRecipientId,
            title: 'Test Title',
            message: 'Test Message',
          }),
        }),
      }),
    });

    mockNotificationModel.find = jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            populate: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue([]),
            }),
          }),
        }),
      }),
    });

    mockNotificationModel.countDocuments = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(5),
    });

    mockNotificationModel.findOneAndUpdate = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(validNotificationId),
        isRead: true,
      }),
    });

    mockNotificationModel.updateMany = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ modifiedCount: 3 }),
    });

    mockNotificationModel.findOneAndDelete = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(validNotificationId),
      }),
    });

    mockUsersService = {
      findById: jest.fn().mockResolvedValue({
        _id: validRecipientId,
        pushToken: 'sample-fcm-token',
      }),
    };

    mockFirebaseService = {
      sendPushNotification: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: getModelToken(Notification.name),
          useValue: mockNotificationModel,
        },
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
        {
          provide: FirebaseService,
          useValue: mockFirebaseService,
        },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createAndSend', () => {
    it('should throw BadRequestException for invalid recipientId', async () => {
      await expect(
        service.createAndSend({
          recipientId: 'invalid-id',
          title: 'Test',
          message: 'Hello',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should save notification and send push if token exists', async () => {
      const result = await service.createAndSend({
        recipientId: validRecipientId,
        senderId: validSenderId,
        type: NotificationType.GIFT_RECEIVED,
        title: 'هدية جديدة',
        message: 'أرسل لك هدية',
      });

      expect(result).toBeDefined();
      expect(mockUsersService.findById).toHaveBeenCalledWith(validRecipientId);
      expect(mockFirebaseService.sendPushNotification).toHaveBeenCalledWith(
        'sample-fcm-token',
        'هدية جديدة',
        'أرسل لك هدية',
        expect.any(Object),
      );
    });
  });

  describe('getUserNotifications', () => {
    it('should throw BadRequestException if userId is invalid', async () => {
      await expect(service.getUserNotifications('invalid')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should return paginated notifications and unreadCount', async () => {
      const res = await service.getUserNotifications(validRecipientId, 1, 10);
      expect(res).toBeDefined();
      expect(res.total).toBe(5);
      expect(res.unreadCount).toBe(5);
    });
  });

  describe('markAsRead', () => {
    it('should mark notification as read', async () => {
      const updated = await service.markAsRead(validNotificationId, validRecipientId);
      expect(updated.isRead).toBe(true);
    });

    it('should throw NotFoundException if notification does not exist', async () => {
      mockNotificationModel.findOneAndUpdate = jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(
        service.markAsRead(validNotificationId, validRecipientId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('markAllAsRead', () => {
    it('should mark all unread notifications as read', async () => {
      const res = await service.markAllAsRead(validRecipientId);
      expect(res.modifiedCount).toBe(3);
    });
  });
});
