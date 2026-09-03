import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { FirebaseService } from '../firebase/firebase.service';
import { AdminsService } from '../admins/admins.service';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private firebaseService: FirebaseService,
    private adminsService: AdminsService,
  ) {}

  async adminLogin(username: string, pass: string) {
    const admin = await this.adminsService.findByUsername(username);
    if (!admin) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const isMatch = await bcrypt.compare(pass, admin.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }
    
    // We can reuse generateTokens but flag it as admin somehow or just use a specific payload
    // Let's create a custom token structure for admins
    const payload = { sub: admin._id.toString(), username: admin.username, role: admin.role, isAdmin: true };
    const accessToken = this.jwtService.sign(payload, { expiresIn: '1d' });
    
    return {
      accessToken,
      admin: {
        id: admin._id,
        name: admin.name,
        username: admin.username,
        role: admin.role,
      }
    };
  }

  async firebaseLogin(idToken: string) {
    let decodedToken;
    try {
      decodedToken = await this.firebaseService
        .getAuth()
        .verifyIdToken(idToken);
    } catch (error: any) {
      console.error('Firebase token verification failed:', error);
      throw new UnauthorizedException(
        `Invalid Firebase token: ${error.message}`,
      );
    }

    const { uid, email, name, picture, phone_number } = decodedToken;

    // Check by firebaseUid first (including deleted)
    let user = await this.usersService.findAnyByFirebaseUid(uid);

    if (!user) {
      // Try to link account (including deleted)
      user = await this.usersService.findAnyLinkableAccount(
        email,
        phone_number,
      );

      if (user) {
        user.firebaseUid = uid;
        if (picture && !user.avatarUrl) user.avatarUrl = picture;
        if (name && !user.displayName) user.displayName = name;
        if (email && !user.email) {
          user.email = email;
          user.emailVerified = true;
        }
        if (phone_number && !user.phone) {
          user.phone = phone_number;
          user.phoneVerified = true;
        }
      } else {
        // Create new user (username is NOT generated, user must set it in onboarding)
        user = await this.usersService.findOrCreateByFirebaseUid(uid, {
          email: email || undefined,
          emailVerified: !!email,
          phone: phone_number || undefined,
          phoneVerified: !!phone_number,
          authProvider: 'firebase',
          avatarUrl: picture || null,
          displayName: name || null,
        });
      }
    }

    // Check Grace Period for Restoration
    if (user.isDeleted) {
      const now = new Date();
      if (
        user.deletionGracePeriodUntil &&
        now <= user.deletionGracePeriodUntil
      ) {
        // Restore account
        user.isDeleted = false;
        user.deletedAt = null as any;
        user.deletionGracePeriodUntil = null as any;
        user.usernameReservedUntil = null as any;
        user.originalUsername = null as any;
      } else {
        throw new UnauthorizedException('هذا الحساب محذوف نهائياً.');
      }
    }

    if (user.isBanned) {
      throw new UnauthorizedException('هذا الحساب محظور.');
    }

    await user.save();

    return this.generateTokens((user._id as any).toString(), user.username);
  }

  async refresh(userId: string, refreshToken: string, family: string) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Reuse detection
    if (user.refreshTokenFamily !== family) {
      // The token presented is for a different family entirely, just invalid.
      throw new UnauthorizedException('Invalid token family');
    }

    const isMatch = await bcrypt.compare(refreshToken, user.hashedRefreshToken);
    if (!isMatch) {
      // Reuse detected! The family matches but the token itself does not match the active one.
      // Action: Invalidate the entire family (revoke all sessions)
      await this.usersService.updateRefreshTokenFamily(userId, null, null);
      throw new UnauthorizedException(
        'Token reuse detected. Sessions revoked.',
      );
    }

    // Valid token. Rotate it.
    return this.generateTokens(userId, user.username, family);
  }

  async logout(userId: string) {
    await this.usersService.updateRefreshTokenFamily(userId, null, null);
    return { success: true };
  }

  private async generateTokens(
    userId: string,
    username: string,
    existingFamily?: string,
  ) {
    const payload = { sub: userId, username };

    const accessToken = this.jwtService.sign(payload, { expiresIn: '15m' });

    const family = existingFamily || randomUUID();
    const refreshPayload = { ...payload, family, nonce: randomUUID() };

    // Refresh token lives for 30 days but is signed with a different secret
    // Note: We use the refresh secret configured in the module
    const refreshToken = this.jwtService.sign(refreshPayload, {
      expiresIn: '30d',
      secret: process.env.JWT_REFRESH_SECRET,
    });

    const salt = await bcrypt.genSalt(10);
    const hashedToken = await bcrypt.hash(refreshToken, salt);

    await this.usersService.updateRefreshTokenFamily(
      userId,
      family,
      hashedToken,
    );

    return {
      accessToken,
      refreshToken,
    };
  }
}
