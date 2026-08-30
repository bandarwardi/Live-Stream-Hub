# Backend Agent Directives — NestJS / MongoDB / Socket.io

These rules are specific to the NestJS backend codebase. They extend the
project-level rules in the root `AGENTS.md` and must all be followed together.

---

## 1. MongoDB ObjectId Validation

Never pass a raw client-supplied string directly to `findById()` or any Mongoose
query without validation. Invalid ObjectIds cause unhandled `CastError` exceptions
that crash the request.

**Rules:**
- Import and use `mongoose.Types.ObjectId.isValid(id)` before any database lookup
  that accepts an ID from the client (HTTP params, WebSocket payloads).
- Return a clear `BadRequestException` or `WsException` with a human-readable
  message if the ID is invalid — do not let the CastError propagate.

```ts
import { Types } from 'mongoose';

if (!Types.ObjectId.isValid(conversationId)) {
  throw new BadRequestException('Invalid conversation ID');
}
```

---

## 2. WebSocket Room Naming

Socket.io rooms for direct messages use the pattern `conv-{conversationId}`.
The `conversationId` MUST be a real MongoDB ObjectId that exists in the
`conversations` collection.

**Rules:**
- In `joinConversation`, verify the conversation exists before joining the room.
- In `sendDirectMessage`, verify the sender is a participant of the conversation
  before saving or broadcasting.
- Never construct room names from placeholder values or user-supplied strings
  that have not been validated against the database.

---

## 3. Storage and Media URL Consistency

The `API_URL` environment variable in `.env` determines the base URL prepended to
stored media paths. If this points to a stale production URL while the server runs
locally, all media URLs returned to the client will be unreachable (404).

**Rules:**
- During local development, `API_URL` must be set to the LAN-accessible address
  (e.g., `http://192.168.1.x:3000`) so that mobile devices on the same network
  can fetch uploaded images, audio, and video.
- The storage proxy routes (`/storage/chat-media/*`) must match the paths that
  the frontend constructs from `mediaUrl` fields in message documents.

---

## 4. Message Persistence and Real-Time Broadcast

When handling `sendDirectMessage` in the WebSocket gateway:

1. **Validate** the conversation ID and sender participation.
2. **Save** the message to MongoDB via `ConversationsService.saveMessage()`.
3. **Broadcast** the saved (populated) message to the room `conv-{id}` using
   `server.to(roomName).emit('newDirectMessage', savedMessage)`.
4. **Update** unread counts for all participants except the sender.
5. **Send push notification** to offline participants.

All five steps must succeed atomically for a message to be considered "sent".
If step 2 fails, do NOT broadcast. If step 3 fails, the message is saved but
the sender should be informed of the delivery failure.

---

## 5. Gift and Coin Economy

When processing gift messages:
- **Deduct** coins from the sender BEFORE saving the message. If the sender has
  insufficient balance, return an error immediately — do not save or broadcast.
- **Credit** coins to the recipient AFTER saving the message successfully.
- Never modify coin balances without corresponding database writes. In-memory
  balance tracking is not acceptable.

---

## 6. CORS and Authentication

- CORS is set to `origin: '*'` for development. Before deploying to production,
  restrict this to the actual client origins.
- The `WsJwtGuard` must verify tokens on every `@SubscribeMessage` handler that
  mutates data. Read-only queries may be unguarded if appropriate.
- On `connect_error` with an expired JWT, the client will attempt a token refresh
  and reconnect — ensure the server accepts the new token without requiring a
  full page reload.
