[![npm](https://img.shields.io/npm/v/@fastify-extra/connect-redis.svg)](https://npmjs.com/package/@fastify-extra/connect-redis) ![Downloads](https://img.shields.io/npm/dm/@fastify-extra/connect-redis.svg)

**@fastify-extra/connect-redis** provides Redis session storage for Fastify.

## Installation

**@fastify-extra/connect-redis** requires `@fastify/session` and [`redis`][1]:

```sh
npm install redis @fastify-extra/connect-redis @fastify/session
```

## API

Full setup:

```js
import { RedisStore } from "@fastify-extra/connect-redis";
import fastifySession from "@fastify/session";
import { createClient } from "redis";

// Initialize client.
let redisClient = createClient();
redisClient.connect().catch(console.error);

// Initialize store.
let redisStore = new RedisStore({
  client: redisClient,
  prefix: "myapp:",
});

// Initialize session storage.
app.register(fastifySession, {
  store: redisStore,
  saveUninitialized: false, // recommended: only save session when data exists
  secret: "keyboard cat",
});
```

### RedisStore(options)

#### Options

##### client

An instance of [`redis`][1]

##### prefix

Key prefix in Redis (default: `sess:`).

**Note**: This prefix appends to whatever prefix you may have set on the `client` itself.

**Note**: You may need unique prefixes for different applications sharing the same Redis instance. This limits bulk commands exposed in `@fastify/session` (like `length`, `all`, `keys`, and `clear`) to a single application's data.

##### ttl

If the session cookie has a `expires` date, `@fastify-extra/connect-redis` will use it as the TTL.

Otherwise, it will expire the session using the `ttl` option (default: `86400` seconds or one day).

```ts
interface RedisStoreOptions {
  ...
  ttl?: number | {(sess: SessionData): number}
}
```

`ttl` also has external callback support. You can use it for dynamic TTL generation. It has access to `session` data.

**Note**: The TTL is reset every time a user interacts with the server. You can disable this behavior in _some_ instances by using `disableTouch`.

**Note**: `@fastify/session` does not update `expires` until the end of the request life cycle. _Calling `session.save()` manually beforehand will have the previous value_.

##### disableTouch

Disables resetting the TTL when using `touch` (default: `false`)

The `@fastify/session` package uses `touch` to signal to the store that the user has interacted with the session but hasn't changed anything in its data. Typically, this helps keep the users session alive if session changes are infrequent but you may want to disable it to cut down the extra calls or to prevent users from keeping sessions open too long. Also consider enabling if you store a lot of data on the session.

##### disableTTL

Disables key expiration completely (default: `false`)

This option disables key expiration requiring the user to manually manage key cleanup outside of `@fastify-extra/connect-redis`. Only use if you know what you are doing and have an exceptional case where you need to manage your own expiration in Redis.

**Note**: This has no effect on `@fastify/session` setting cookie expiration.

##### serializer

Provide a custom encoder/decoder to use when storing and retrieving session data from Redis (default: `JSON.parse` and `JSON.stringify`).

Optionally `parse` method can be async if need be.

```ts
interface Serializer {
  parse(string): object | Promise<object>;
  stringify(object): string;
}
```

##### scanCount

Value used for _count_ parameter in [Redis `SCAN` command](https://redis.io/commands/scan#the-count-option). Used for `ids()` and `all()` methods (default: `100`).

[1]: https://github.com/NodeRedis/node-redis
